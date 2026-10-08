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
// 2 = integer doc ids (context_docs.id) and a WITHOUT ROWID term table.
export const CONTEXT_INDEX_VERSION = 2;

// Most-weighted terms stored per document: BASE_TERMS_PER_DOC plus one per
// distinct CJK bigram, up to MAX_TERMS_PER_DOC. English recall stopped
// improving at ~300 terms, but CJK bigrams yield about one term per
// character, so a flat 300 would leave most of a Chinese document
// unsearchable. See docs/context-guide.md for size/speed numbers.
const BASE_TERMS_PER_DOC = 300;
const MAX_TERMS_PER_DOC = 1000;
// Long enough for a migration of a large corpus in another process.
const BUSY_TIMEOUT_MS = 30_000;

// Scripts written without spaces between words. Indexed as overlapping
// character bigrams (the Lucene CJKAnalyzer approach): dictionary
// segmentation can split the same phrase differently in a short query vs. a
// long document, while bigrams match regardless of context. U+30FC (the
// katakana long-vowel mark) is Script=Common, so it is listed explicitly.
const CJK_RUN = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30FC]+)/u;
// One CJK character (CJK_RUN's character class), to count bigram terms.
const CJK_CHAR = new RegExp(CJK_RUN.source.slice(1, -2), "u");
// Arabic tashkeel (harakat, shadda, sukun, Quranic marks) and tatweel —
// optional in normal writing, so the same word may appear with or without them.
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
// Hamza-on-alef and madda forms, written or omitted interchangeably.
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625]/g;
// Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) digits.
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
// Hebrew niqqud and cantillation marks, optional in normal writing.
const HEBREW_MARKS = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;
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
    for (const { segment } of segmenter.segment(piece)) {
      // A segment is a word if it has a letter or digit. isWordLike isn't
      // used: on some ICU builds (Bun on Linux) it is false for numbers.
      // 3+ code points, as before, to drop short function words.
      if (WORD_CHAR.test(segment) && [...segment].length >= 3) tokens.push(segment);
    }
  });
  return tokens;
}

// An unreadable subfolder is recorded in `skipped` and left out: partial
// indexing beats failing the whole source. An unreadable root still throws.
function* walkDir(dir: string, skipped: string[], isRoot = true): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (isRoot) throw err;
    skipped.push(dir);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      yield* walkDir(full, skipped, false);
    } else if (/\.(txt|md|mdx|rst)$/.test(entry.name)) {
      yield full;
    }
  }
}

function isSqliteError(err: unknown): boolean {
  return String((err as { code?: unknown })?.code ?? "").startsWith("SQLITE_");
}

/** A newly added source, plus subfolders that couldn't be read and were skipped. */
export interface AddedContextSource extends ContextSource {
  skippedDirs: string[];
}

// Each file gets an integer id; terms reference it instead of repeating the
// source id and file path on every row (which made up most of the db size).
// context_terms is WITHOUT ROWID with PRIMARY KEY (term, doc_id), so a term
// lookup is a seek on the table's own clustered key, no separate index needed.
const DOCS_TERMS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS context_docs (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL,
    UNIQUE (source_id, file_path)
  );
  CREATE TABLE IF NOT EXISTS context_terms (
    term TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (term, doc_id)
  ) WITHOUT ROWID;
`;

export class ContextStore {
  private db: Database;
  // True only for a read-only db still in the pre-v2 layout (terms keyed by
  // source_id + file_path); retrieve() then reads that layout as-is.
  private legacySchema = false;

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
        ${DOCS_TERMS_SCHEMA}
      `);
      this._migrate();
      this.legacySchema = this._hasLegacySchema();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const busy = String((err as { code?: unknown })?.code ?? "").startsWith("SQLITE_BUSY");
      throw new TlError(
        "CONTEXT_DB_ERROR",
        `Failed to open context db at ${dbPath}: ${msg}`,
        busy
          ? "Another tl process is probably re-indexing the context database (this happens once after an upgrade). Wait for it to finish and try again."
          : `Check that ${dbPath} is writable`,
        err,
      );
    }
  }

  addSource(path: string): AddedContextSource {
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) throw new Error(`${path} is not a directory`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("CONTEXT_DB_ERROR", `Invalid path: ${msg}`, `Provide a readable directory path`, err);
    }

    const id = randomUUID();
    const addedAt = new Date().toISOString();

    // Replace any existing row and index in one transaction: if indexing
    // fails, nothing is left behind and a previous source stays intact.
    let skippedDirs: string[] = [];
    try {
      this.db.transaction(() => {
        const existing = this.db.query(`SELECT id FROM context_sources WHERE path = ?`).get(path) as { id: string } | null;
        if (existing) {
          this._deleteIndexRows(existing.id);
          this.db.run(`DELETE FROM context_sources WHERE id = ?`, [existing.id]);
        }
        this.db.run(`INSERT INTO context_sources (id, path, added_at) VALUES (?, ?, ?)`, [id, path, addedAt]);
        skippedDirs = this._indexSource(id, path);
      })();
    } catch (err: unknown) {
      if (isSqliteError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("CONTEXT_DB_ERROR", `Failed to index ${path}: ${msg}`, `Check that ${path} is readable`, err);
    }

    const row = this.db.query(`SELECT id, path, added_at, indexed_at, file_count FROM context_sources WHERE id = ?`).get(id) as any;
    return {
      id: row.id,
      path: row.path,
      addedAt: row.added_at,
      indexedAt: row.indexed_at ?? undefined,
      fileCount: row.file_count,
      skippedDirs,
    };
  }

  removeSource(id: string): void {
    const row = this.db.query(`SELECT id FROM context_sources WHERE id = ?`).get(id) as { id: string } | null;
    if (!row) {
      throw new TlError("CONTEXT_DB_ERROR", `Context source not found: ${id}`, `Check the id is valid`);
    }
    this.db.transaction(() => {
      this._deleteIndexRows(id);
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

  /** Rebuild every source. Returns subfolders that couldn't be read and were skipped. */
  reindex(): string[] {
    const skipped: string[] = [];
    for (const src of this.listSources()) skipped.push(...this._reindexSource(src));
    return skipped;
  }

  retrieve(query: string, limit = 5): ContextSnippet[] {
    // Dedupe: bigram tokenization repeats terms, and each one is a bind param.
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const { sql, params } = this._retrieveQuery(terms, limit);
    const rows = this.db.query(sql).all(...params) as { source_id: string; file_path: string; content: string | null; score: number }[];
    return rows.map((r) => ({
      sourceId: r.source_id,
      filePath: r.file_path,
      content: r.content ?? "",
      score: r.score,
    }));
  }

  private _retrieveQuery(terms: string[], limit: number): { sql: string; params: (string | number)[] } {
    const placeholders = terms.map(() => "?").join(", ");
    if (this.legacySchema) {
      return {
        sql: `
          SELECT t.source_id, t.file_path, d.content, SUM(t.tf_idf) AS score
          FROM context_terms t
          LEFT JOIN context_docs d ON d.source_id = t.source_id AND d.file_path = t.file_path
          WHERE t.term IN (${placeholders})
          GROUP BY t.source_id, t.file_path
          ORDER BY score DESC
          LIMIT ?`,
        params: [...terms, limit],
      };
    }
    return {
      sql: `
        SELECT d.source_id, d.file_path, d.content, s.score
        FROM (
          SELECT doc_id, SUM(weight) AS score
          FROM context_terms
          WHERE term IN (${placeholders})
          GROUP BY doc_id
          ORDER BY score DESC
          LIMIT ?
        ) s
        JOIN context_docs d ON d.id = s.doc_id
        ORDER BY s.score DESC`,
      params: [...terms, limit],
    };
  }

  private _deleteIndexRows(sourceId: string): void {
    this.db.run(`DELETE FROM context_terms WHERE doc_id IN (SELECT id FROM context_docs WHERE source_id = ?)`, [sourceId]);
    this.db.run(`DELETE FROM context_docs WHERE source_id = ?`, [sourceId]);
  }

  private _hasLegacySchema(): boolean {
    return (this.db.query(`PRAGMA table_info(context_terms)`).all() as { name: string }[])
      .some((c) => c.name === "source_id");
  }

  close(): void {
    this.db.close();
  }

  // One transaction: if the directory walk or a read fails, the delete rolls
  // back and the source keeps its previous index.
  private _reindexSource(src: { id: string; path: string }): string[] {
    let skipped: string[] = [];
    this.db.transaction(() => {
      this._deleteIndexRows(src.id);
      skipped = this._indexSource(src.id, src.path);
    })();
    return skipped;
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
    const reachable = (src: { path: string }) => {
      try { readdirSync(src.path); return true; } catch { return false; }
    };
    // Read-only check first: if the only stale sources are unreachable, there
    // is nothing to do, so don't take a write lock on every open.
    if (!this._hasLegacySchema() && hasColumn() && !stale().some(reachable)) return;

    try {
      this.db.transaction(() => {
        // Re-check under the write lock: another process may have finished first.
        if (!hasColumn()) {
          this.db.run(`ALTER TABLE context_sources ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0`);
        }
        if (this._hasLegacySchema()) {
          // Convert to integer doc ids, copying the old rows so a source that
          // can't be re-indexed right now (see below) still has an index.
          this.db.exec(`
            ALTER TABLE context_docs RENAME TO legacy_context_docs;
            ALTER TABLE context_terms RENAME TO legacy_context_terms;
            ${DOCS_TERMS_SCHEMA}
            INSERT INTO context_docs (source_id, file_path, content)
              SELECT source_id, file_path, content FROM legacy_context_docs;
            INSERT INTO context_terms (term, doc_id, weight)
              SELECT t.term, d.id, t.tf_idf FROM legacy_context_terms t
              JOIN context_docs d ON d.source_id = t.source_id AND d.file_path = t.file_path;
            DROP TABLE legacy_context_terms;
            DROP TABLE legacy_context_docs;
          `);
        }
        for (const src of stale()) {
          // Any indexing failure (unmounted drive, moved or unreadable folder,
          // I/O error) keeps the source's old index; its savepoint rolls back
          // and it is retried on a later open. Database errors propagate.
          try {
            this._reindexSource(src);
          } catch (err) {
            if (isSqliteError(err)) throw err;
          }
        }
      }).immediate();
    } catch (err: unknown) {
      // Read-only db: keep serving the old index rather than failing every command.
      if ((err as { code?: string }).code === "SQLITE_READONLY") return;
      throw err;
    }
  }

  // Returns subfolders that couldn't be read and were skipped.
  private _indexSource(sourceId: string, dirPath: string): string[] {
    const files: string[] = [];
    const skipped: string[] = [];
    for (const f of walkDir(dirPath, skipped)) files.push(f);

    if (files.length === 0) {
      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = 0, index_version = ? WHERE id = ?`, [new Date().toISOString(), CONTEXT_INDEX_VERSION, sourceId]);
      return skipped;
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
    const insertDoc = this.db.prepare(`INSERT INTO context_docs (source_id, file_path, content) VALUES (?, ?, ?)`);
    const insertTerm = this.db.prepare(`INSERT INTO context_terms (term, doc_id, weight) VALUES (?, ?, ?)`);

    this.db.transaction(() => {
      let indexedCount = 0;
      for (const [file, { termFreq, tokenCount, snippet }] of fileData) {
        if (tokenCount === 0) continue;
        indexedCount++;

        const docId = insertDoc.run(sourceId, file, snippet).lastInsertRowid;

        const scored: { term: string; score: number }[] = [];
        let cjkTerms = 0;
        for (const [term, freq] of termFreq) {
          const tf = freq / tokenCount;
          const idf = Math.log(totalDocs / (docFrequency.get(term) ?? 1));
          scored.push({ term, score: tf * idf });
          if (CJK_CHAR.test(term)) cjkTerms++;
        }

        scored.sort((a, b) => b.score - a.score);
        const cap = Math.min(MAX_TERMS_PER_DOC, BASE_TERMS_PER_DOC + cjkTerms);
        for (const { term, score } of scored.slice(0, cap)) {
          insertTerm.run(term, docId, score);
        }
      }

      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = ?, index_version = ? WHERE id = ?`, [
        new Date().toISOString(),
        indexedCount,
        CONTEXT_INDEX_VERSION,
        sourceId,
      ]);
    })();
    return skipped;
  }
}
