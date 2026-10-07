import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { ContextStore, tokenize } from "../context";

// Temp SQLite + local files only — no external services, so run by default.
// The former TEST_INTEGRATION gate hid the whole suite from plain `bun run test`.
const testFn = test;

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

  test("applies NFKC normalization (full-width Latin)", () => {
    expect(tokenize("ＡＢＣＤ")).toEqual(["abcd"]);
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

  test("short Japanese query retrieves the Japanese doc", () => {
    const s = store.retrieve("小麦粉");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].filePath).toContain("ja.md");
  });
});

describe("ContextStore tokenizer migration", () => {
  test("reindexes sources indexed by an older tokenizer on open", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-migrate-"));
    try {
      const docs = join(tmpDir, "docs");
      mkdirSync(docs);
      writeFileSync(join(docs, "zh.md"), "机器学习使用神经网络分析大量数据");
      writeFileSync(join(docs, "en.md"), "cooking recipe flour butter");
      const dbPath = join(tmpDir, "context.db");

      let store = new ContextStore(dbPath);
      store.addSource(docs);
      store.close();

      // Simulate a db written by the old ASCII-only tokenizer.
      const db = new Database(dbPath);
      db.run(`DELETE FROM context_terms WHERE file_path LIKE '%zh.md'`);
      db.run(`PRAGMA user_version = 0`);
      db.close();

      store = new ContextStore(dbPath);
      const s = store.retrieve("神经网络");
      store.close();
      expect(s.length).toBeGreaterThan(0);
      expect(s[0].filePath).toContain("zh.md");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
