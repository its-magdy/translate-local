import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "@translate-local/shared/constants";

/**
 * Whether `repaired` is `draft` plus sentence-final punctuation the source
 * lacks (`Supprimer cet hôte` → `Supprimer cet hôte.`). That fixes no
 * agreement and UI labels have none; it was 13 of the 56 applied repairs in
 * the file-mode bench, none of them otherwise useful.
 */
export function appendsEndPunctuation(draft: string, repaired: string, source: string): boolean {
  return (
    repaired.startsWith(draft) &&
    /^\s*[.!?…。！？؟]+$/u.test(repaired.slice(draft.length)) &&
    !endsWithPunctuation(source)
  );
}

/**
 * Sentence-final punctuation in a source: `.`, `!`, `?`, `…`, `‼⁉‽`, CJK,
 * Arabic, Urdu, Devanagari, Armenian, Ethiopic, Myanmar, Khmer, Tibetan and
 * the Greek question mark (U+037E, which NFC turns into `;`).
 */
const END_PUNCTUATION = ".!?…‼⁉‽。．！？؟۔।॥։።။។།;;";
/** The full stops dropped from a translation. */
const FULL_STOPS = ".。．۔।";
/**
 * What may follow a sentence's end punctuation: closing quotes and brackets,
 * markdown emphasis and code closers, and bidi marks (LRM, RLM, ALM).
 */
const CLOSERS = `"'”’»›)]}」』）*_\`‎‏؜`;
/** Bidi marks a translation may end with after its full stop. */
const BIDI_MARKS = "‎‏؜";
/** Abbreviations a translation can end with although the source has no full stop (lowercase). */
const ABBREVIATIONS = new Set([
  "etc", "usw", "bzw", "ggf", "inkl", "vgl", "ca", "vs", "cf", "inc", "ltd", "co", "corp", "jr", "sr",
  "nr", "min", "sek", "std", "mio", "mrd", "tsd", "max", "ex", "env", "dr", "mr", "approx",
]);

/** The index just before a placeholder sentinel ending at `end` (exclusive), or -1 if none ends there. */
function sentinelStart(text: string, end: number): number {
  if (!text.startsWith(PLACEHOLDER_SENTINEL_SUFFIX, end - PLACEHOLDER_SENTINEL_SUFFIX.length)) return -1;
  let i = end - PLACEHOLDER_SENTINEL_SUFFIX.length;
  const digitsEnd = i;
  while (i > 0 && text[i - 1] >= "0" && text[i - 1] <= "9") i--;
  if (i === digitsEnd || !text.startsWith(PLACEHOLDER_SENTINEL_PREFIX, i - PLACEHOLDER_SENTINEL_PREFIX.length)) return -1;
  return i - PLACEHOLDER_SENTINEL_PREFIX.length;
}

/**
 * Whether `source` ends with sentence-final punctuation, maybe followed by
 * whitespace, closers (see CLOSERS) and placeholder sentinels
 * (`Read the __TLPH_0__docs.__TLPH_1__`, `**Saved.**`).
 */
function endsWithPunctuation(source: string): boolean {
  let end = source.length;
  while (end > 0) {
    const ch = source[end - 1];
    if (/\s/u.test(ch) || CLOSERS.includes(ch)) {
      // A sentinel ends with `_`, so try it first: it is skipped whole.
      const start = sentinelStart(source, end);
      end = start >= 0 ? start : end - 1;
      continue;
    }
    const start = sentinelStart(source, end);
    if (start < 0) break;
    end = start;
  }
  return end > 0 && END_PUNCTUATION.includes(source[end - 1]);
}

/**
 * Drops the full stop the model put at the end of `translated` when the
 * source has no sentence-final punctuation (`Save changes` →
 * `Enregistrer les modifications.`): UI labels have none, and the model added
 * one to about 6 of 131 catalog labels per language in the file-mode bench.
 * Trailing bidi marks after the stop are kept. A `.` is kept when the last
 * word has any other dot (`..`, `z.B.`), is one letter (`z. B.`) or a common
 * abbreviation (`etc.`, `Bestell-Nr.`), or when a glossary target term or
 * form ends with it. `translated` is already trimmed.
 */
export function dropAddedFullStop(translated: string, source: string, terms: string[]): string {
  if (translated === "" || source.trim() === "" || endsWithPunctuation(source)) return translated;
  let end = translated.length;
  while (end > 0 && BIDI_MARKS.includes(translated[end - 1])) end--;
  if (end === 0 || !FULL_STOPS.includes(translated[end - 1])) return translated;
  const head = translated.slice(0, end);
  const body = translated.slice(0, end - 1);
  if (head.endsWith(".")) {
    let start = body.length;
    while (start > 0 && !/\s/u.test(body[start - 1])) start--;
    const word = body.slice(start).toLowerCase();
    if (word === "" || word.includes(".") || /^\p{L}$/u.test(word)) return translated;
    if (ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.slice(word.lastIndexOf("-") + 1))) return translated;
    if (terms.some((term) => term.endsWith(".") && head.endsWith(term))) return translated;
  }
  return body + translated.slice(end);
}
