import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import type { ContextSource, ContextSnippet } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
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
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
      this.db = new Database(dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS context_sources (
          id TEXT PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          added_at TEXT NOT NULL,
          indexed_at TEXT,
          file_count INTEGER DEFAULT 0
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
    const sources = this.listSources();
    for (const src of sources) {
      this.db.transaction(() => {
        this.db.run(`DELETE FROM context_terms WHERE source_id = ?`, [src.id]);
        this.db.run(`DELETE FROM context_docs WHERE source_id = ?`, [src.id]);
      })();
      this._indexSource(src.id, src.path);
    }
  }

  retrieve(query: string, limit = 5): ContextSnippet[] {
    const terms = tokenize(query);
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

  private _indexSource(sourceId: string, dirPath: string): void {
    const files: string[] = [];
    for (const f of walkDir(dirPath)) files.push(f);

    if (files.length === 0) {
      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = 0 WHERE id = ?`, [new Date().toISOString(), sourceId]);
      return;
    }

    // Pass 1: build per-file token lists and document frequency
    const fileData = new Map<string, { tokens: string[]; text: string }>();
    const docFrequency = new Map<string, number>();

    for (const file of files) {
      let text = "";
      try { text = readFileSync(file, "utf8"); } catch { continue; }
      const tokens = tokenize(text);
      fileData.set(file, { tokens, text });
      const unique = new Set(tokens);
      for (const term of unique) {
        docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
      }
    }

    const totalDocs = fileData.size;

    // Pass 2: compute TF-IDF per file
    const insertDoc = this.db.prepare(`INSERT OR REPLACE INTO context_docs (source_id, file_path, content) VALUES (?, ?, ?)`);
    const insertTerm = this.db.prepare(`INSERT OR REPLACE INTO context_terms (source_id, file_path, term, tf_idf) VALUES (?, ?, ?, ?)`);

    this.db.transaction(() => {
      let indexedCount = 0;
      for (const [file, { tokens, text }] of fileData) {
        if (tokens.length === 0) continue;
        indexedCount++;

        insertDoc.run(sourceId, file, text.slice(0, 500));

        const termFreq = new Map<string, number>();
        for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

        const scored: { term: string; score: number }[] = [];
        for (const [term, freq] of termFreq) {
          const tf = freq / tokens.length;
          const idf = Math.log(totalDocs / (docFrequency.get(term) ?? 1));
          scored.push({ term, score: tf * idf });
        }

        scored.sort((a, b) => b.score - a.score);
        for (const { term, score } of scored.slice(0, 100)) {
          insertTerm.run(sourceId, file, term, score);
        }
      }

      this.db.run(`UPDATE context_sources SET indexed_at = ?, file_count = ? WHERE id = ?`, [
        new Date().toISOString(),
        indexedCount,
        sourceId,
      ]);
    })();
  }
}
