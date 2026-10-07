import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { ContextSource, ContextSnippet } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { ensurePrivateDir } from "./fsutil";

// Bump whenever tokenize() output or the stored term weights change. Terms are
// persisted in context_terms, so each source records the version it was
// indexed with (context_sources.index_version; 0 = before this column existed)
// and older sources are rebuilt on open.
export const CONTEXT_INDEX_VERSION = 1;

// Most-weighted terms stored per document. CJK bigrams yield roughly one term
// per character, so the old cap of 100 made only the first ~100 characters of
// a Chinese document searchable. 1000 keeps every term of CJK documents up to
// ~1,000–1,500 characters; for English, recall stopped improving at ~300 in
// measurements. See docs/context-guide.md for size/speed numbers.
const MAX_TERMS_PER_DOC = 1000;
// Long enough for a migration of a large corpus in another process.
const BUSY_TIMEOUT_MS = 30_000;

// Scripts written without spaces between words. Indexed as overlapping
// character bigrams (the Lucene CJKAnalyzer approach): dictionary
// segmentation can split the same phrase differently in a short query vs. a
// long document, while bigrams match regardless of context. U+30FC (the
// katakana long-vowel mark) is Script=Common, so it is listed explicitly.
const CJK_RUN = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30FC]+)/u;
// Arabic tashkeel (harakat, shadda, sukun, Quranic marks) and tatweel —
// optional in normal writing, so the same word may appear with or without them.
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
// Hamza-on-alef and madda forms, written or omitted interchangeably.
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625]/g;
// Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) digits.
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
// Hebrew niqqud and cantillation marks, optional in normal writing.
const HEBREW_MARKS = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
// UAX #29 word boundaries; also dictionary-segments Thai/Lao/Khmer/Myanmar.
const segmenter = new Intl.Segmenter("und", { granularity: "word" });

export function tokenize(text: string): string[] {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_MARKS, "")
    .replace(ARABIC_ALEF_VARIANTS, "\u0627")
    .replace(EASTERN_DIGITS, (d) => String((d.charCodeAt(0) - 0x0660) % 0x90))
    .replace(HEBREW_MARKS, "");
  const tokens: string[] = [];
  // split() with a capture group alternates: non-CJK text at even indices,
  // CJK runs at odd indices.
  normalized.split(CJK_RUN).forEach((piece, i) => {
    if (i % 2 === 1) {
      const chars = [...piece];
      if (chars.length === 1) tokens.push(piece);
      for (let j = 0; j + 1 < chars.length; j++) tokens.push(chars[j] + chars[j + 1]);
      return;
    }
    for (const { segment, isWordLike } of segmenter.segment(piece)) {
      // 3+ code points, as before, to drop short function words.
      if (isWordLike && [...segment].length >= 3) tokens.push(segment);
    }
  });
  return tokens;
}

function* walkDir(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      yield* walkDir(full);
    } else if (/\.(txt|md|mdx|rst)$/.test(entry.name)) {
      yield full;
    }
  }
}

export class ContextStore {
  private db: Database;

  constructor(dbPath: string) {
    try {
      ensurePrivateDir(dbPath);
      this.db = new Database(dbPath);
      // Another process may be migrating or indexing; wait instead of
      // failing with "database is locked".
      this.db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS context_sources (
          id TEXT PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          added_at TEXT NOT NULL,
          indexed_at TEXT,
          file_count INTEGER DEFAULT 0,
          index_version INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS context_docs (
          source_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content TEXT NOT NULL,
          PRIMARY KEY (source_id, file_path)
        );
        CREATE TABLE IF NOT EXISTS context_terms (
          source_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          term TEXT NOT NULL,
          tf_idf REAL NOT NULL,
          PRIMARY KEY (source_id, file_path, term)
        );
        CREATE INDEX IF NOT EXISTS idx_terms_lookup ON context_terms(source_id, term);
      `);
      this._migrate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError(
        "CONTEXT_DB_ERROR",
        `Failed to open context db at ${dbPath}: ${msg}`,
        `Check that ${dbPath} is writable`,
        err,
      );
    }
  }

  addSource(path: string): ContextSource {
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) throw new Error(`${path} is not a directory`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("CONTEXT_DB_ERROR", `Invalid path: ${msg}`, `Provide a readable directory path`, err);
    }

    const id = randomUUID();
    const addedAt = new Date().toISOString();

    // Clean up existing row if present, then insert — all in one transaction
    this.db.transaction(() => {
      const existing = this.db.query(`SELECT id FROM context_sources WHERE path = ?`).get(path) as { id: string } | null;
      if (existing) {
        this.db.run(`DELETE FROM context_terms WHERE source_id = ?`, [existing.id]);
        this.db.run(`DELETE FROM context_docs WHERE source_id = ?`, [existing.id]);
        this.db.run(`DELETE FROM context_sources WHERE id = ?`, [existing.id]);
      }
      this.db.run(`INSERT INTO context_sources (id, path, added_at) VALUES (?, ?, ?)`, [id, path, addedAt]);
    })();
    this._indexSource(id, path);

    const row = this.db.query(`SELECT id, path, added_at, indexed_at, file_count FROM context_sources WHERE id = ?`).get(id) as any;
    return {
      id: row.id,
      path: row.path,
      addedAt: row.added_at,
      indexedAt: row.indexed_at ?? undefined,
      fileCount: row.file_count,
    };
  }

  removeSource(id: string): void {
    const row = this.db.query(`SELECT id FROM context_sources WHERE id = ?`).get(id) as { id: string } | null;
    if (!row) {
      throw new TlError("CONTEXT_DB_ERROR", `Context source not found: ${id}`, `Check the id is valid`);
    }
    this.db.transaction(() => {
      this.db.run(`DELETE FROM context_terms WHERE source_id = ?`, [id]);
      this.db.run(`DELETE FROM context_docs WHERE source_id = ?`, [id]);
      this.db.run(`DELETE FROM context_sources WHERE id = ?`, [id]);
    })();
  }

  listSources(): ContextSource[] {
    const rows = this.db.query(`SELECT id, path, added_at, indexed_at, file_count FROM context_sources ORDER BY added_at ASC`).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      addedAt: r.added_at,
      indexedAt: r.indexed_at ?? undefined,
      fileCount: r.file_count,
    }));
  }

  reindex(): void {
    for (const src of this.listSources()) this._reindexSource(src);
  }

  retrieve(query: string, limit = 5): ContextSnippet[] {
    // Dedupe: bigram tokenization repeats terms, and each one is a bind param.
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const placeholders = terms.map(() => "?").join(", ");
    const rows = this.db.query(`
      SELECT t.source_id, t.file_path, SUM(t.tf_idf) AS score
      FROM context_terms t
      WHERE t.term IN (${placeholders})
      GROUP BY t.source_id, t.file_path
      ORDER BY score DESC
      LIMIT ?
    `).all(...terms, limit) as { source_id: string; file_path: string; score: number }[];

    if (rows.length === 0) return [];

    return rows.map((r) => {
      const doc = this.db.query(`SELECT content FROM context_docs WHERE source_id = ? AND file_path = ?`).get(r.source_id, r.file_path) as { content: string } | null;
      return {
        sourceId: r.source_id,
        filePath: r.file_path,
        content: doc?.content ?? "",
        score: r.score,
      };
    });
  }

  close(): void {
    this.db.close();
  }

  // One transaction: if the directory walk or a read fails, the delete rolls
  // back and the source keeps its previous index.
  private _reindexSource(src: { id: string; path: string }): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM context_terms WHERE source_id = ?`, [src.id]);
      this.db.run(`DELETE FROM context_docs WHERE source_id = ?`, [src.id]);
      this._indexSource(src.id, src.path);
    })();
  }

  // Rebuild sources indexed by an older CONTEXT_INDEX_VERSION. Runs as one
  // IMMEDIATE transaction so concurrent opens serialize (busy_timeout) and a
  // crash mid-migration leaves the old index intact.
  private _migrate(): void {
    const hasColumn = () =>
      (this.db.query(`PRAGMA table_info(context_sources)`).all() as { name: string }[])
        .some((c) => c.name === "index_version");
    const stale = () =>
      this.db.query(`SELECT id, path FROM context_sources WHERE index_version < ?`)
        .all(CONTEXT_INDEX_VERSION) as { id: string; path: string }[];
    if (hasColumn() && stale().length === 0) return;

    try {
      this.db.transaction(() => {
        // Re-check under the write lock: another process may have finished first.
        if (!hasColumn()) {
          this.db.run(`ALTER TABLE context_sources ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0`);
        }
        for (const src of stale()) {
          // Unreachable folder (unmounted drive, moved directory): keep the old
          // index and retry on a later open. Other errors propagate.
          try { readdirSync(src.path); } catch { continue; }
          this._reindexSource(src);
        }
      }).immediate();
    } catch (err: unknown) {
      // Read-only db: keep serving the old index rather than failing every command.
      if ((err as { code?: string }).code === "SQLITE_READONLY") return;
      throw err;
    }
  }

  private _indexSource(sourceId: string, dirPath: string): void {
    const files: string[] = [];
    for (const f of walkDir(dirPath)) files.push(f);

    if (files.length === 0) {
      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = 0, index_version = ? WHERE id = ?`, [new Date().toISOString(), CONTEXT_INDEX_VERSION, sourceId]);
      return;
    }

    // Pass 1: build per-file term frequencies and document frequency. Only the
    // frequencies and a 500-char snippet are kept — holding every file's full
    // text and token array would scale memory with the whole directory's size.
    const fileData = new Map<string, { termFreq: Map<string, number>; tokenCount: number; snippet: string }>();
    const docFrequency = new Map<string, number>();

    for (const file of files) {
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const tokens = tokenize(text);
      const termFreq = new Map<string, number>();
      for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
      fileData.set(file, { termFreq, tokenCount: tokens.length, snippet: text.slice(0, 500) });
      for (const term of termFreq.keys()) {
        docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
      }
    }

    const totalDocs = fileData.size;

    // Pass 2: compute TF-IDF per file
    const insertDoc = this.db.prepare(`INSERT OR REPLACE INTO context_docs (source_id, file_path, content) VALUES (?, ?, ?)`);
    const insertTerm = this.db.prepare(`INSERT OR REPLACE INTO context_terms (source_id, file_path, term, tf_idf) VALUES (?, ?, ?, ?)`);

    this.db.transaction(() => {
      let indexedCount = 0;
      for (const [file, { termFreq, tokenCount, snippet }] of fileData) {
        if (tokenCount === 0) continue;
        indexedCount++;

        insertDoc.run(sourceId, file, snippet);

        const scored: { term: string; score: number }[] = [];
        for (const [term, freq] of termFreq) {
          const tf = freq / tokenCount;
          const idf = Math.log(totalDocs / (docFrequency.get(term) ?? 1));
          scored.push({ term, score: tf * idf });
        }

        scored.sort((a, b) => b.score - a.score);
        for (const { term, score } of scored.slice(0, MAX_TERMS_PER_DOC)) {
          insertTerm.run(sourceId, file, term, score);
        }
      }

      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = ?, index_version = ? WHERE id = ?`, [
        new Date().toISOString(),
        indexedCount,
        CONTEXT_INDEX_VERSION,
        sourceId,
      ]);
    })();
  }
}
