import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { langFallbackChain, normalizeLang } from "@translate-local/shared/utils/language";
import { ensurePrivateDir } from "./fsutil";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scripts written without spaces between words. Terms in these scripts are
 * matched as plain substrings: there is no boundary to anchor on, and
 * dictionary segmentation (Intl.Segmenter) splits text by its own lexicon,
 * which need not agree with a user's glossary entries. scx (Script_Extensions)
 * also covers shared marks like the kana prolonged-sound mark ー.
 */
const NO_SPACE_SCRIPTS =
  "\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Khmer}\\p{scx=Myanmar}";

/** A word character of a space-delimited script (Latin, Cyrillic, Arabic, Hangul, Devanagari, …). */
const SPACED_WORD_CHAR = `[[\\p{L}\\p{N}\\p{M}_]--[${NO_SPACE_SCRIPTS}]]`;
const SPACED_WORD_RE = new RegExp(`^${SPACED_WORD_CHAR}$`, "v");

/**
 * Build a match regex for a glossary term.
 *
 * `\\b` is ASCII-only (it treats "é" as a non-word char, so "caf" matched inside
 * "café"), so boundaries are Unicode lookarounds instead. Each edge of the term
 * is decided by its edge character:
 * - a word char of a space-delimited script → the neighbour must not be one
 *   (whole-word match; combining marks count as word chars, so a match never
 *   ends mid-grapheme);
 * - a char of a script without word spaces (CJK, kana, Thai, …), or
 *   punctuation → no assertion (substring match).
 *
 * Neighbours from no-space scripts never block a match, so "API" still matches
 * in "このAPIキー". Arabic clitics (ال / و / ب …) are not stripped: "كتاب" does
 * not match inside "الكتاب" — add inflected forms as their own entries.
 *
 * Compiled patterns are cached: file mode calls matchTerms once per leaf with
 * the same entries, and recompiling per call dominated the non-model cost.
 * (matchAll clones the regex, so sharing a cached instance is safe.)
 */
const patternCache = new Map<string, RegExp>();

function termPattern(term: string): RegExp {
  let pattern = patternCache.get(term);
  if (!pattern) {
    const chars = [...term];
    const start = SPACED_WORD_RE.test(chars[0]) ? `(?<!${SPACED_WORD_CHAR})` : "";
    const end = SPACED_WORD_RE.test(chars[chars.length - 1]) ? `(?!${SPACED_WORD_CHAR})` : "";
    pattern = new RegExp(`${start}${escapeRegex(term)}${end}`, "giv");
    patternCache.set(term, pattern);
  }
  return pattern;
}

/**
 * Match glossary terms in text (Unicode-aware, see termPattern).
 * Longest-first greedy to avoid partial overlaps.
 * Returns hits sorted by startIndex ascending.
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
    const conditions: string[] = [];
    const params: string[] = [];
    if (sourceLang) { conditions.push("source_lang = ?"); params.push(sourceLang); }
    if (targetLang) { conditions.push("target_lang = ?"); params.push(targetLang); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    return this.queryEntries(where, params, "Failed to list glossary entries");
  }

  private queryEntries(where: string, params: string[], failure: string): GlossaryEntry[] {
    try {
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
      throw new TlError("GLOSSARY_DB_ERROR", `${failure}: ${msg}`, "Check db integrity", err);
    }
  }

  /**
   * Entries usable for translating sourceLang → targetLang, with BCP-47 lookup
   * fallback on both sides: "en-US" → "fr-CA" also sees en/fr, en-US/fr and
   * en/fr-CA entries (case-insensitive). Fallback only widens toward the base,
   * never the other way: an "en" query does not see "en-US" entries. When a
   * source term has entries at several levels, only the most specific survive
   * (by number of matched subtags, source + target).
   */
  lookup(sourceLang: string, targetLang: string): GlossaryEntry[] {
    const sourceChain = langFallbackChain(sourceLang);
    const targetChain = langFallbackChain(targetLang);
    const specificity = (e: GlossaryEntry) =>
      (sourceChain.length - sourceChain.indexOf(normalizeLang(e.sourceLang))) +
      (targetChain.length - targetChain.indexOf(normalizeLang(e.targetLang)));

    const candidates = this.queryEntries(
      ` WHERE lower(source_lang) IN (${sourceChain.map(() => "?").join(", ")})` +
        ` AND lower(target_lang) IN (${targetChain.map(() => "?").join(", ")})`,
      [...sourceChain, ...targetChain],
      "Failed to look up glossary entries",
    );

    const best = new Map<string, number>();
    for (const e of candidates) {
      best.set(e.sourceTerm, Math.max(best.get(e.sourceTerm) ?? 0, specificity(e)));
    }
    return candidates.filter((e) => specificity(e) === best.get(e.sourceTerm));
  }

  findMatches(text: string, sourceLang: string, targetLang: string): GlossaryHit[] {
    const entries = this.lookup(sourceLang, targetLang);
    return matchTerms(text, entries);
  }

  close(): void {
    this.db.close();
  }
}
