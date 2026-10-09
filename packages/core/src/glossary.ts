import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import type { GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { langFallbackChain, normalizeLang } from "@translate-local/shared/utils/language";
import { SQLITE_BUSY_TIMEOUT_MS } from "@translate-local/shared/constants";
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

/**
 * One word character of a space-delimited script (Latin, Cyrillic, Arabic,
 * Hangul, Devanagari, …). ZWNJ/ZWJ join word parts (Persian کتاب‌ها), so they
 * count as word characters too. Compiled once: embedding this class in every
 * term's regex cost ~10 ms of JSC compile time per term.
 */
const SPACED_WORD_RE = new RegExp(`^[[\\p{L}\\p{N}\\p{M}_\\u200C\\u200D]--[${NO_SPACE_SCRIPTS}]]$`, "v");

function isSpacedWordChar(ch: string): boolean {
  return ch !== "" && SPACED_WORD_RE.test(ch);
}

/** The code point ending just before UTF-16 index i ("" at the start). */
function charBefore(text: string, i: number): string {
  if (i === 0) return "";
  const low = text.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = text.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

/** The code point starting at UTF-16 index i ("" at the end). */
function charAt(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

interface TermMatcher {
  pattern: RegExp;
  /** The term's first/last char is a spaced-script word char → that edge must sit on a word boundary. */
  checkStart: boolean;
  checkEnd: boolean;
}

/**
 * Build a matcher for a glossary term.
 *
 * `\b` is ASCII-only (it treats "é" as a non-word char, so "caf" matched inside
 * "café"), so boundaries are checked in JS around each candidate match. Each
 * edge of the term is decided by its edge character:
 * - a word char of a space-delimited script → the neighbouring code point must
 *   not be one (whole-word match; combining marks and ZWNJ/ZWJ count as word
 *   chars, so a match never ends mid-grapheme or mid-word);
 * - a char of a script without word spaces (CJK, kana, Thai, …), or
 *   punctuation → no check (substring match).
 *
 * Neighbours from no-space scripts never block a match, so "API" still matches
 * in "このAPIキー". Arabic clitics (ال / و / ب …) are not stripped: "كتاب" does
 * not match inside "الكتاب" — add inflected forms as their own entries.
 *
 * The regex itself is just the escaped term (cheap to compile). Matchers are
 * cached: file mode calls matchTerms once per leaf with the same entries.
 */
const matcherCache = new Map<string, TermMatcher>();

function termMatcher(term: string): TermMatcher {
  let matcher = matcherCache.get(term);
  if (!matcher) {
    const chars = [...term];
    matcher = {
      // No u flag: literal terms don't need it, and JSC's u+i matching is
      // several times slower. Boundaries are checked by code point below.
      pattern: new RegExp(escapeRegex(term), "gi"),
      checkStart: isSpacedWordChar(chars[0]),
      checkEnd: isSpacedWordChar(chars[chars.length - 1]),
    };
    matcherCache.set(term, matcher);
  }
  return matcher;
}

/**
 * Match glossary terms in text (Unicode-aware, see termMatcher).
 * Longest-first greedy to avoid partial overlaps.
 * Returns hits sorted by startIndex ascending.
 */
export function matchTerms(text: string, entries: GlossaryEntry[]): GlossaryHit[] {
  const sorted = [...entries].sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  const hits: GlossaryHit[] = [];
  const occupied = new Uint8Array(text.length);

  for (const entry of sorted) {
    // An empty term builds a zero-width pattern and the exec() loop below would
    // never advance. add() rejects empty terms, but old rows may exist.
    if (entry.sourceTerm.trim().length === 0) continue;
    const { pattern, checkStart, checkEnd } = termMatcher(entry.sourceTerm);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const bounded =
        (!checkStart || !isSpacedWordChar(charBefore(text, start))) &&
        (!checkEnd || !isSpacedWordChar(charAt(text, end)));
      if (!bounded) {
        // Retry one code point later: a valid occurrence may overlap this one.
        pattern.lastIndex = start + charAt(text, start).length;
        continue;
      }
      if (!occupied.subarray(start, end).some(Boolean)) {
        hits.push({ entry, startIndex: start, endIndex: end });
        occupied.fill(1, start, end);
      }
    }
  }

  return hits.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Case-fold key equal to the term regex's `i` folding (ES Canonicalize without
 * the u flag): per UTF-16 unit, toUpperCase when that stays one unit and does
 * not map non-ASCII onto ASCII. Groups entries that match the same text.
 * Simple folding only — "ß" and "SS" differ, as do "İ" and "i".
 */
function foldKey(term: string): string {
  let out = "";
  for (let i = 0; i < term.length; i++) {
    const ch = term[i];
    const upper = ch.toUpperCase();
    out += upper.length === 1 && !(ch.charCodeAt(0) >= 128 && upper.charCodeAt(0) < 128) ? upper : ch;
  }
  return out;
}

export class GlossaryStore {
  private db: Database;

  constructor(dbPath: string) {
    try {
      ensurePrivateDir(dbPath);
      this.db = new Database(dbPath);
      this.db.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
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
   * source term (case-insensitively) has entries at several levels, only the
   * most specific survive: deeper target tag first, then deeper source tag.
   */
  lookup(sourceLang: string, targetLang: string): GlossaryEntry[] {
    const sourceChain = langFallbackChain(sourceLang);
    const targetChain = langFallbackChain(targetLang);
    // Depth of the matched tag (1 = base language). Target outranks source: the
    // output language decides the right term, so en/fr-CA beats en-US/fr.
    const depth = (chain: string[], lang: string) => chain.length - chain.indexOf(normalizeLang(lang));
    const rank = (e: GlossaryEntry) =>
      depth(targetChain, e.targetLang) * (sourceChain.length + 1) + depth(sourceChain, e.sourceLang);

    const candidates = this.queryEntries(
      ` WHERE lower(source_lang) IN (${sourceChain.map(() => "?").join(", ")})` +
        ` AND lower(target_lang) IN (${targetChain.map(() => "?").join(", ")})`,
      [...sourceChain, ...targetChain],
      "Failed to look up glossary entries",
    );

    // Keyed on the case fold: matching is case-insensitive, so "Email" and
    // "email" compete for the same text.
    const best = new Map<string, number>();
    for (const e of candidates) {
      const key = foldKey(e.sourceTerm);
      best.set(key, Math.max(best.get(key) ?? 0, rank(e)));
    }
    return candidates.filter((e) => rank(e) === best.get(foldKey(e.sourceTerm)));
  }

  findMatches(text: string, sourceLang: string, targetLang: string): GlossaryHit[] {
    const entries = this.lookup(sourceLang, targetLang);
    return matchTerms(text, entries);
  }

  close(): void {
    this.db.close();
  }
}
