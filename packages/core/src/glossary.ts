import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { ensurePrivateDir } from "./fsutil";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LATIN_START = /^[a-zA-Z0-9_]/;
const LATIN_END = /[a-zA-Z0-9_]$/;

/**
 * Build a word-boundary regex for a glossary term.
 *
 * For ASCII word characters, plain \b works. For non-Latin characters
 * (CJK, Arabic, etc.), we use Unicode-aware negative lookbehind/lookahead
 * with \p{L} so the term is not matched as a substring of a longer word.
 *
 * Compiled patterns are cached: file mode calls matchTerms once per leaf with
 * the same entries, and recompiling per call dominated the non-model cost.
 * (matchAll clones the regex, so sharing a cached instance is safe.)
 */
const patternCache = new Map<string, RegExp>();

function termPattern(term: string): RegExp {
  let pattern = patternCache.get(term);
  if (!pattern) {
    const escaped = escapeRegex(term);
    const start = LATIN_START.test(term) ? "\\b" : "(?<!\\p{L})";
    const end = LATIN_END.test(term) ? "\\b" : "(?!\\p{L})";
    pattern = new RegExp(`${start}${escaped}${end}`, "giu");
    patternCache.set(term, pattern);
  }
  return pattern;
}

/**
 * Match glossary terms in text using word-boundary matching.
 * Longest-first greedy to avoid partial overlaps.
 * Returns hits sorted by startIndex ascending.
 *
 * Uses Unicode-aware boundaries (\p{L}) for non-Latin terms (Arabic, etc.).
 *
 * Known limitation: CJK scripts have no word boundaries between adjacent characters.
 * CJK glossary terms only match when delimited by punctuation, spaces, or string edges.
 */
export function matchTerms(text: string, entries: GlossaryEntry[]): GlossaryHit[] {
  const sorted = [...entries].sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  const hits: GlossaryHit[] = [];
  const occupied = new Uint8Array(text.length);

  for (const entry of sorted) {
    // An empty term builds a zero-width pattern; a manual exec() loop would never
    // advance lastIndex and hang forever. matchAll steps past zero-width matches,
    // and empty terms are skipped outright (add() rejects them, but old rows may exist).
    if (entry.sourceTerm.trim().length === 0) continue;
    const pattern = termPattern(entry.sourceTerm);
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!occupied.subarray(start, end).some(Boolean)) {
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
      ensurePrivateDir(dbPath);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError(
        "GLOSSARY_DB_ERROR",
        `Failed to open glossary db at ${dbPath}: ${msg}`,
        `Check that ${dbPath} is writable`,
        err,
      );
    }
  }

  add(entry: Omit<GlossaryEntry, "id">): GlossaryEntry {
    if (entry.sourceTerm.trim().length === 0 || entry.targetTerm.trim().length === 0) {
      throw new TlError(
        "INVALID_INPUT",
        "Glossary source and target terms must be non-empty",
        "Provide non-empty --source and --target values.",
      );
    }
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
        ).get(entry.sourceTerm, entry.targetTerm, entry.sourceLang, entry.targetLang) as { id: string } | null;
        if (existing) return { id: existing.id, ...entry };
        // Row vanished between INSERT OR IGNORE and SELECT — fall through to return the new id
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to add glossary entry: ${msg}`, "Check for db corruption", err);
    }
    return { id, ...entry };
  }

  /** Add many entries in one transaction — bulk import pays one commit instead of one per row. */
  addMany(entries: Omit<GlossaryEntry, "id">[]): number {
    this.db.transaction(() => {
      for (const e of entries) this.add(e);
    })();
    return entries.length;
  }

  remove(id: string): boolean {
    try {
      const result = this.db.run(`DELETE FROM glossary WHERE id = ?`, [id]);
      return result.changes > 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to remove glossary entry: ${msg}`, "Check the id is valid", err);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("GLOSSARY_DB_ERROR", `Failed to list glossary entries: ${msg}`, "Check db integrity", err);
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
