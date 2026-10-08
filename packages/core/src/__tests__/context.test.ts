import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, renameSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { ContextStore, tokenize, CONTEXT_INDEX_VERSION } from "../context";

// Temp SQLite + local files only — no external services, so run by default.
// The former TEST_INTEGRATION gate hid the whole suite from plain `bun run test`.
const testFn = test;
// chmod 000 doesn't stop root (e.g. tests run in a container as root).
const permTest = test.skipIf(process.getuid?.() === 0);

describe("ContextStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: ContextStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-test-"));
    dbPath = join(tmpDir, "context.db");

    // Create 3 md files with distinct vocabulary
    writeFileSync(join(tmpDir, "machine.md"), "machine learning neural network deep learning gradient descent backpropagation training data");
    writeFileSync(join(tmpDir, "cooking.md"), "cooking recipe ingredients flour butter sugar bake oven temperature");
    writeFileSync(join(tmpDir, "medical.md"), "diagnosis treatment medication prescription dosage clinical patient physician");
  });

  afterEach(() => {
    store?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  testFn("addSource returns correct fileCount and sets indexedAt", () => {
    store = new ContextStore(dbPath);
    const source = store.addSource(tmpDir);
    expect(source.fileCount).toBe(3);
    expect(source.indexedAt).toBeDefined();
    expect(source.path).toBe(tmpDir);
    expect(source.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  testFn("listSources returns the added source", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const sources = store.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe(tmpDir);
  });

  testFn("retrieve returns machine.md as top result for machine learning query", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const snippets = store.retrieve("machine learning", 5);
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0].filePath).toContain("machine.md");
  });

  testFn("retrieve returns empty array for unknown query", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const snippets = store.retrieve("zzzzz");
    expect(snippets).toEqual([]);
  });

  testFn("removeSource empties list and retrieve returns empty", () => {
    store = new ContextStore(dbPath);
    const source = store.addSource(tmpDir);
    store.removeSource(source.id);
    expect(store.listSources()).toHaveLength(0);
    expect(store.retrieve("machine learning")).toEqual([]);
  });

  testFn("reindex updates fileCount after new file is added", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);

    // Add a new file
    writeFileSync(join(tmpDir, "legal.md"), "contract statute jurisdiction litigation plaintiff defendant court");
    store.reindex();

    const sources = store.listSources();
    expect(sources[0].fileCount).toBe(4);
    const snippets = store.retrieve("litigation court");
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0].filePath).toContain("legal.md");
  });

  testFn("addSource same path twice returns 1 source (no duplicates)", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    store.addSource(tmpDir);
    const sources = store.listSources();
    expect(sources).toHaveLength(1);
  });

  testFn("addSource with invalid path throws CONTEXT_DB_ERROR", () => {
    store = new ContextStore(dbPath);
    expect(() => store.addSource("/nonexistent/path/that/does/not/exist")).toThrow();
    try {
      store.addSource("/nonexistent/path/that/does/not/exist");
    } catch (err: any) {
      expect(err.tag).toBe("CONTEXT_DB_ERROR");
    }
  });

  describe("unreadable folders", () => {
    const locked: string[] = [];
    function lock(dir: string): void {
      chmodSync(dir, 0o000);
      locked.push(dir);
    }
    afterEach(() => {
      for (const d of locked.splice(0)) chmodSync(d, 0o755);
    });

    permTest("addSource skips an unreadable subfolder and reports it", () => {
      const sub = join(tmpDir, "private");
      mkdirSync(sub);
      writeFileSync(join(sub, "secret.md"), "volcano eruption lava");
      lock(sub);
      store = new ContextStore(dbPath);
      const source = store.addSource(tmpDir);
      expect(source.fileCount).toBe(3);
      expect(source.skippedDirs).toEqual([sub]);
      expect(store.retrieve("machine learning")[0].filePath).toContain("machine.md");
    });

    permTest("reindex skips an unreadable subfolder and reports it", () => {
      store = new ContextStore(dbPath);
      store.addSource(tmpDir);
      const sub = join(tmpDir, "private");
      mkdirSync(sub);
      lock(sub);
      expect(store.reindex()).toEqual([sub]);
      expect(store.listSources()[0].fileCount).toBe(3);
    });

    permTest("a failed addSource leaves no source row behind", () => {
      const root = join(tmpDir, "locked-root");
      mkdirSync(root);
      lock(root);
      store = new ContextStore(dbPath);
      expect(() => store.addSource(root)).toThrow();
      expect(store.listSources()).toEqual([]);
    });

    permTest("re-adding a path that now fails keeps the previous source", () => {
      const root = join(tmpDir, "docs");
      mkdirSync(root);
      writeFileSync(join(root, "a.md"), "volcano eruption lava");
      store = new ContextStore(dbPath);
      store.addSource(root);
      lock(root);
      expect(() => store.addSource(root)).toThrow();
      expect(store.listSources().map((s) => s.path)).toEqual([root]);
      expect(store.retrieve("volcano").length).toBe(1);
    });
  });
});

describe("tokenize", () => {
  test("keeps English behavior: lowercase, 3+ chars", () => {
    expect(tokenize("Machine Learning is OK")).toEqual(["machine", "learning"]);
  });

  test("keeps accented Latin letters inside words", () => {
    expect(tokenize("café naïve")).toEqual(["café", "naïve"]);
  });

  test("tokenizes Arabic and strips tashkeel", () => {
    expect(tokenize("مُحَمَّد يُترجم النصوص")).toEqual(["محمد", "يترجم", "النصوص"]);
  });

  test("tokenizes Russian with lowercase", () => {
    expect(tokenize("Машинное обучение")).toEqual(["машинное", "обучение"]);
  });

  test("emits character bigrams for CJK runs", () => {
    expect(tokenize("机器学习")).toEqual(["机器", "器学", "学习"]);
    expect(tokenize("学")).toEqual(["学"]);
  });

  test("segments Thai into words", () => {
    expect(tokenize("การเรียนรู้ของเครื่อง")).toContain("เครื่อง");
  });

  test("folds Arabic hamza-on-alef forms to bare alef", () => {
    expect(tokenize("أحمد إسلام آمال")).toEqual(tokenize("احمد اسلام امال"));
  });

  // Segmenter's isWordLike is false for numbers on some ICU builds (Bun on
  // Linux), so numbers must be kept without relying on it.
  test("keeps numbers and alphanumeric tokens on every platform", () => {
    expect(tokenize("Release v1.2 build 2024, error 404")).toEqual(["release", "v1.2", "build", "2024", "error", "404"]);
  });

  test("maps Arabic-Indic and Persian digits to ASCII", () => {
    expect(tokenize("٢٠٢٤ ۱۲۳")).toEqual(["2024", "123"]);
  });

  test("strips Hebrew niqqud", () => {
    expect(tokenize("שָׁלוֹם")).toEqual(["שלום"]);
  });

  test("drops Snowball stopwords for en/fr/de/es/it/pt/ru", () => {
    expect(tokenize("You have been logged out of your account")).toEqual(["logged", "account"]);
    expect(tokenize("Don’t share your password")).toEqual(["share", "password"]);
    // Snowball keeps "été" (also "summer").
    expect(tokenize("Vous avez été déconnecté de votre compte")).toEqual(["été", "déconnecté", "compte"]);
    expect(tokenize("Sie wurden von Ihrem Konto abgemeldet")).toEqual(["wurden", "konto", "abgemeldet"]);
    expect(tokenize("Se ha cerrado la sesión de su cuenta")).toEqual(["cerrado", "sesión", "cuenta"]);
    expect(tokenize("Sei stato disconnesso dal tuo account")).toEqual(["stato", "disconnesso", "account"]);
    expect(tokenize("Você foi desconectado da sua conta")).toEqual(["desconectado", "conta"]);
    expect(tokenize("Вы вышли из своей учётной записи")).toEqual(["вышли", "своей", "учётной", "записи"]);
  });

  test("drops English and Arabic stopwords", () => {
    expect(tokenize("The invoice and the payment")).toEqual(["invoice", "payment"]);
    expect(tokenize("ذهب إلى السوق")).toEqual(["ذهب", "السوق"]);
  });

  test("applies NFKC normalization (full-width Latin)", () => {
    expect(tokenize("ＡＢＣＤ")).toEqual(["abcd"]);
  });
});

describe("ContextStore relevance score", () => {
  let tmpDir: string;
  let store: ContextStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-score-"));
    store = new ContextStore(join(tmpDir, "context.db"));
  });

  afterEach(() => {
    store?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function source(files: Record<string, string>): string {
    const docs = mkdtempSync(join(tmpDir, "docs-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(docs, name), body);
    store.addSource(docs);
    return docs;
  }

  test("a single-file source scores above zero", () => {
    source({ "style.md": "Always say sign in, never log in. The product is called Dashboard." });
    const s = store.retrieve("sign in to dashboard");
    expect(s).toHaveLength(1);
    expect(s[0].score).toBeGreaterThan(0);
  });

  test("a query identical to a document scores 1", () => {
    source({ "a.md": "alpha bravo charlie", "b.md": "delta echo foxtrot" });
    const [top] = store.retrieve("alpha bravo charlie");
    expect(top.filePath).toContain("a.md");
    expect(top.score).toBeCloseTo(1, 5);
  });

  test("scores stay within (0, 1]", () => {
    source({
      "a.md": "machine learning machine learning neural network training data gradient",
      "b.md": "cooking recipe flour butter sugar oven machine",
      "c.md": "machine",
    });
    for (const q of ["machine", "machine learning", "machine machine machine", "flour sugar butter oven recipe cooking"]) {
      for (const r of store.retrieve(q)) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  test("a query matching one rare term of a long doc ranks below a focused doc", () => {
    source({
      "focused.md": "invoice billing payment invoice",
      "long.md": "release notes for the dashboard covering search filters export themes sidebar invoice widgets",
    });
    const s = store.retrieve("invoice billing");
    expect(s[0].filePath).toContain("focused.md");
    expect(s[0].score).toBeGreaterThan(s[1].score);
  });

  test("minRelevance drops results scoring below it", () => {
    source({
      "focused.md": "invoice billing payment invoice",
      "long.md": "release notes for the dashboard covering search filters export themes sidebar invoice widgets",
    });
    const all = store.retrieve("invoice billing", 5);
    expect(all).toHaveLength(2);
    const cut = (all[0].score + all[1].score) / 2;
    const kept = store.retrieve("invoice billing", 5, cut);
    expect(kept).toHaveLength(1);
    expect(kept[0].filePath).toContain("focused.md");
  });
});

describe("ContextStore non-Latin retrieval", () => {
  let tmpDir: string;
  let store: ContextStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-unicode-"));
    const docs = join(tmpDir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "ar.md"), "التعلم الآلي يستخدم الشبكات العصبية لتحليل البيانات الضخمة");
    writeFileSync(join(docs, "ru.md"), "Машинное обучение использует нейронные сети для анализа данных");
    writeFileSync(join(docs, "zh.md"), "机器学习使用神经网络分析大量数据");
    writeFileSync(join(docs, "ja.md"), "料理のレシピでは小麦粉とバターと砂糖を使います");
    writeFileSync(join(docs, "en.md"), "cooking recipe ingredients flour butter sugar bake oven");
    store = new ContextStore(join(tmpDir, "context.db"));
    store.addSource(docs);
  });

  afterEach(() => {
    store?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("Arabic query retrieves the Arabic doc (diacritics ignored)", () => {
    const s = store.retrieve("الشَّبَكَات العصبية");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("ar.md");
  });

  test("Russian query retrieves the Russian doc (case-insensitive)", () => {
    const s = store.retrieve("НЕЙРОННЫЕ сети");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("ru.md");
  });

  test("short Chinese query retrieves the Chinese doc", () => {
    const s = store.retrieve("神经网络");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("zh.md");
  });

  test("the end of a long Chinese doc stays searchable", () => {
    const docs2 = join(tmpDir, "docs-long");
    mkdirSync(docs2);
    // ~600 distinct bigrams (the old 100-term cap kept only the first ~100),
    // then a closing sentence with unique terms.
    const filler = Array.from({ length: 600 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
    writeFileSync(join(docs2, "long.md"), `${filler}。数据保留期限为九十天，过期后自动删除。`);
    writeFileSync(join(docs2, "other.md"), "旅行指南：春天是游览杭州的最佳季节。");
    store.addSource(docs2);
    const s = store.retrieve("过期后自动删除");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("long.md");
  });

  test("short Japanese query retrieves the Japanese doc", () => {
    const s = store.retrieve("小麦粉");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("ja.md");
  });
});

describe("ContextStore index migration", () => {
  let tmpDir: string;
  let docs: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-migrate-"));
    docs = join(tmpDir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "zh.md"), "机器学习使用神经网络分析大量数据");
    writeFileSync(join(docs, "en.md"), "cooking recipe flour butter");
    dbPath = join(tmpDir, "context.db");
    const store = new ContextStore(dbPath);
    store.addSource(docs);
    store.close();
  });

  afterEach(() => {
    try { chmodSync(dbPath, 0o644); } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Turn the db into what the pre-Unicode release wrote: no index_version
  // column, terms keyed by (source_id, file_path), and no terms for the
  // Chinese file (the old ASCII tokenizer had none).
  function makeLegacy(oldWeight = 0.1): void {
    const db = new Database(dbPath);
    db.exec(`
      PRAGMA user_version = 0;
      ALTER TABLE context_sources DROP COLUMN index_version;
      DROP TABLE context_terms;
      ALTER TABLE context_docs RENAME TO new_docs;
      CREATE TABLE context_docs (
        source_id TEXT NOT NULL, file_path TEXT NOT NULL, content TEXT NOT NULL,
        PRIMARY KEY (source_id, file_path)
      );
      INSERT INTO context_docs SELECT source_id, file_path, content FROM new_docs;
      DROP TABLE new_docs;
      CREATE TABLE context_terms (
        source_id TEXT NOT NULL, file_path TEXT NOT NULL, term TEXT NOT NULL, tf_idf REAL NOT NULL,
        PRIMARY KEY (source_id, file_path, term)
      );
      CREATE INDEX idx_terms_lookup ON context_terms(source_id, term);
      INSERT INTO context_terms
        SELECT source_id, file_path, w.term, ${oldWeight} FROM context_docs,
          (SELECT 'cooking' AS term UNION SELECT 'recipe' UNION SELECT 'flour' UNION SELECT 'butter') w
        WHERE file_path LIKE '%en.md';
    `);
    db.close();
  }

  test("retrieval is an index lookup on the term table", () => {
    open((store) => {
      const { sql, params } = (store as any)._retrieveQuery(["cooking", "recipe"], 5);
      const plan = ((store as any).db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
        .map((r) => r.detail).join("\n");
      expect(plan).toMatch(/SEARCH context_terms USING PRIMARY KEY \(term=\?\)/);
      expect(plan).not.toMatch(/SCAN context_terms/);
    });
  });

  test("terms reference integer doc ids instead of repeating paths", () => {
    const db = new Database(dbPath, { readonly: true });
    const cols = (db.query(`PRAGMA table_info(context_terms)`).all() as { name: string }[]).map((c) => c.name);
    db.close();
    expect(cols).toEqual(["term", "doc_id", "weight"]);
  });

  function indexVersion(): number {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(`SELECT index_version FROM context_sources`).get() as { index_version: number };
    db.close();
    return row.index_version;
  }

  function open<T>(fn: (store: ContextStore) => T): T {
    const store = new ContextStore(dbPath);
    try { return fn(store); } finally { store.close(); }
  }

  test("reindexes a legacy db on open", () => {
    makeLegacy();
    const s = open((store) => store.retrieve("神经网络"));
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("zh.md");
    expect(indexVersion()).toBe(CONTEXT_INDEX_VERSION);
  });

  test("a current db does no reindex work on open", () => {
    writeFileSync(join(docs, "new.md"), "volcano eruption lava");
    expect(open((store) => store.retrieve("volcano"))).toEqual([]);
  });

  test("a source indexed by a newer version is left untouched", () => {
    const db = new Database(dbPath);
    db.run(`UPDATE context_sources SET index_version = ?`, [CONTEXT_INDEX_VERSION + 1]);
    db.close();
    writeFileSync(join(docs, "new.md"), "volcano eruption lava");
    expect(open((store) => store.retrieve("volcano"))).toEqual([]);
    expect(indexVersion()).toBe(CONTEXT_INDEX_VERSION + 1);
  });

  function expectBounded(snippets: { score: number }[]): void {
    for (const s of snippets) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  }

  test("a missing source folder keeps its old index and is retried on a later open", () => {
    makeLegacy();
    renameSync(docs, `${docs}-moved`);
    // Old terms still answer queries; the source is not marked migrated.
    const before = open((store) => store.retrieve("cooking recipe"));
    expect(before.length).toBe(1);
    expectBounded(before);
    expect(open((store) => store.listSources()[0].fileCount)).toBe(2);
    expect(indexVersion()).toBe(0);

    renameSync(`${docs}-moved`, docs);
    const after = open((store) => store.retrieve("神经网络"));
    expect(after.length).toBeGreaterThan(0);
    expectBounded(after);
    expect(indexVersion()).toBe(CONTEXT_INDEX_VERSION);
  });

  test("copied legacy rows are re-normalized and never outrank a fresh exact match", () => {
    // main's sums of tf*idf could reach ~3; a stale doc must not score above 1.
    makeLegacy(3);
    renameSync(docs, `${docs}-moved`);
    const fresh = join(tmpDir, "fresh");
    mkdirSync(fresh);
    writeFileSync(join(fresh, "a.md"), "cooking recipe flour butter");
    writeFileSync(join(fresh, "b.md"), "volcano eruption lava");
    open((store) => store.addSource(fresh));
    const s = open((store) => store.retrieve("cooking recipe flour butter"));
    expectBounded(s);
    expect(s.map((x) => x.filePath).sort()).toEqual([join(`${docs}`, "en.md"), join(fresh, "a.md")].sort());
    expect(s[0].score).toBeCloseTo(s[1].score, 5);
  });

  test("a stale doc whose old weights are all zero is dropped, not kept as garbage", () => {
    makeLegacy(0); // main's idf ln(N/df) is 0 for a term in every file
    renameSync(docs, `${docs}-moved`);
    expect(open((store) => store.retrieve("cooking recipe"))).toEqual([]);
  });

  test("rows of a source left at an older index version are re-normalized", () => {
    renameSync(docs, `${docs}-moved`);
    const db = new Database(dbPath);
    db.run(`UPDATE context_terms SET weight = weight * 7`);
    db.run(`UPDATE context_sources SET index_version = ?`, [CONTEXT_INDEX_VERSION - 1]);
    db.run(`PRAGMA user_version = ${CONTEXT_INDEX_VERSION - 1}`);
    db.close();
    const s = open((store) => store.retrieve("cooking recipe flour butter"));
    expect(s.length).toBe(1);
    expectBounded(s);
  });

  test("scores are clamped to 1", () => {
    const s = open((store) => store.retrieve("cooking recipe flour butter"));
    expect(s[0].score).toBeLessThanOrEqual(1);
  });

  test("an unreachable source does not take a write lock on later opens", () => {
    makeLegacy();
    renameSync(docs, `${docs}-moved`);
    open(() => {}); // converts the schema; the source stays stale
    const holder = new Database(dbPath);
    holder.exec("BEGIN IMMEDIATE");
    try {
      const started = Date.now();
      expect(open((store) => store.listSources().length)).toBe(1);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
  });

  permTest("an unreadable subfolder during migration is skipped, not fatal", () => {
    makeLegacy();
    const sub = join(docs, "private");
    mkdirSync(sub);
    writeFileSync(join(sub, "secret.md"), "volcano eruption lava");
    chmodSync(sub, 0o000);
    try {
      expect(open((store) => store.retrieve("神经网络")).length).toBeGreaterThan(0);
      expect(open((store) => store.listSources()[0].fileCount)).toBe(2);
      expect(indexVersion()).toBe(CONTEXT_INDEX_VERSION);
    } finally {
      chmodSync(sub, 0o755);
    }
  });

  permTest("an unreadable source root during migration keeps the old index", () => {
    makeLegacy();
    chmodSync(docs, 0o000);
    try {
      expect(open((store) => store.retrieve("cooking recipe")).length).toBe(1);
      expect(indexVersion()).toBe(0);
    } finally {
      chmodSync(docs, 0o755);
    }
  });

  test("a read-only legacy db opens and serves the old index", () => {
    makeLegacy();
    chmodSync(dbPath, 0o444);
    const s = open((store) => store.retrieve("cooking recipe"));
    expect(s.length).toBe(1);
  });

  test("concurrent opens of a legacy db all succeed", async () => {
    makeLegacy();
    const script = `
      const { ContextStore } = await import(${JSON.stringify(join(import.meta.dir, "../context.ts"))});
      const s = new ContextStore(${JSON.stringify(dbPath)});
      if (s.retrieve("神经网络").length === 0) process.exit(2);
      s.close();
    `;
    const procs = Array.from({ length: 4 }, () =>
      Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" }),
    );
    const codes = await Promise.all(procs.map((p) => p.exited));
    const errors = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
    expect({ codes, errors: errors.filter(Boolean) }).toEqual({ codes: [0, 0, 0, 0], errors: [] });
  });
});
