import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { GlossaryEntry, GlossaryHit } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match glossary terms in text using word-boundary matching.
 * Longest-first greedy to avoid partial overlaps.
 * Returns hits sorted by startIndex ascending.
 *
 * Known limitation: \b operates on ASCII word boundaries (\w = [a-zA-Z0-9_]).
 * For non-Latin source terms (CJK, Arabic, etc.), \b will not match correctly.
 */
export function matchTerms(text: string, entries: GlossaryEntry[]): GlossaryHit[] {
  const sorted = [...entries].sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  const hits: GlossaryHit[] = [];
  const occupied = new Uint8Array(text.length);

  for (const entry of sorted) {
    const pattern = new RegExp(`\\b${escapeRegex(entry.sourceTerm)}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!occupied.slice(start, end).some(Boolean)) {
        hits.push({ entry, startIndex: start, endIndex: end });
        occupied.fill(1, start, end);
      }
    }
  }

  return hits.sort((a, b) => a.startIndex - b.startIndex);
}

export class GlossaryStore {
  private db: Database;

  constructor(dbPath: string) {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS glossary (
          id TEXT PRIMARY KEY,
          source_term TEXT NOT NULL,
          target_term TEXT NOT NULL,
          source_lang TEXT NOT NULL,
          target_lang TEXT NOT NULL,
          domain TEXT,
          note TEXT,
          UNIQUE(source_term, target_term, source_lang, target_lang)
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_langs ON glossary(source_lang, target_lang)`);
    } catch (err: any) {
      throw new TlError(
        "GLOSSARY_DB_ERROR",
        `Failed to open glossary db at ${dbPath}: ${err.message}`,
        `Check that ${dbPath} is writable`,
        err,
      );
    }
  }

  add(entry: Omit<GlossaryEntry, "id">): GlossaryEntry {
    const id = randomUUID();
    try {
      const result = this.db.run(
        `INSERT OR IGNORE INTO glossary (id, source_term, target_term, source_lang, target_lang, domain, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, entry.sourceTerm, entry.targetTerm, entry.sourceLang, entry.targetLang, entry.domain ?? null, entry.note ?? null],
      );
      if (result.changes === 0) {
        // Duplicate entry — return the existing row
        const existing = this.db.query(
          `SELECT id FROM glossary WHERE source_term = ? AND target_term = ? AND source_lang = ? AND target_lang = ?`,
        ).get(entry.sourceTerm, entry.targetTerm, entry.sourceLang, entry.targetLang) as { id: string };
        return { id: existing.id, ...entry };
      }
    } catch (err: any) {
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to add glossary entry: ${err.message}`, "Check for db corruption", err);
    }
    return { id, ...entry };
  }

  remove(id: string): boolean {
    try {
      const result = this.db.run(`DELETE FROM glossary WHERE id = ?`, [id]);
      return result.changes > 0;
    } catch (err: any) {
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to remove glossary entry: ${err.message}`, "Check the id is valid", err);
    }
  }

  list(sourceLang?: string, targetLang?: string): GlossaryEntry[] {
    try {
      const conditions: string[] = [];
      const params: string[] = [];
      if (sourceLang) { conditions.push("source_lang = ?"); params.push(sourceLang); }
      if (targetLang) { conditions.push("target_lang = ?"); params.push(targetLang); }

      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const rows = this.db.query(
        `SELECT id, source_term, target_term, source_lang, target_lang, domain, note FROM glossary${where} ORDER BY source_term ASC`,
      ).all(...params) as any[];

      return rows.map((r) => ({
        id: r.id,
        sourceTerm: r.source_term,
        targetTerm: r.target_term,
        sourceLang: r.source_lang,
        targetLang: r.target_lang,
        domain: r.domain ?? undefined,
        note: r.note ?? undefined,
      }));
    } catch (err: any) {
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to list glossary entries: ${err.message}`, "Check db integrity", err);
    }
  }

  findMatches(text: string, sourceLang: string, targetLang: string): GlossaryHit[] {
    const entries = this.list(sourceLang, targetLang);
    return matchTerms(text, entries);
  }

  close(): void {
    this.db.close();
  }
}
