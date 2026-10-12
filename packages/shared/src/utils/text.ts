import type { GlossaryHit } from "../types";
import { TlError } from "../errors";
import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "../constants";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One class per writing system; Han and kana count as one (Japanese mixes them).
const SCRIPT_RES = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Georgian", "Hebrew", "Arabic", "Syriac", "Thaana", "Devanagari",
  "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai",
  "Lao", "Tibetan", "Myanmar", "Khmer", "Ethiopic", "Hangul", "Han Hiragana Katakana",
].map((names) => new RegExp(`[${names.split(" ").map((n) => `\\p{Script=${n}}`).join("")}]`, "u"));

/** Whether `a` and `b` have letters of a common writing system. */
function sharesScript(a: string, b: string): boolean {
  return SCRIPT_RES.some((re) => re.test(a) && re.test(b));
}

/**
 * Inject glossary XML tags into source text for matched terms.
 * Hits must be sorted by startIndex ascending and non-overlapping.
 * Throws if hits are out-of-order or overlapping.
 *
 * Hits in `codeSwitch` are code-switched (the pipeline's last glossary retry):
 * the tag holds the target term instead of the source word. When the two share
 * no writing system, the source word goes in a `source` attribute,
 * `<term translation="الكاش" source="cache">الكاش</term>`, so the term keeps
 * its meaning (#116: a bare الكاش also reads as "cash"). A same-script source
 * word is left out: the model would copy it (it `server` for `host`).
 */
export function injectGlossaryTags(text: string, hits: GlossaryHit[], codeSwitch: readonly GlossaryHit[] = []): string {
  if (hits.length === 0) return text;

  for (let i = 1; i < hits.length; i++) {
    if (hits[i].startIndex < hits[i - 1].endIndex) {
      throw new TlError("INVALID_INPUT", "injectGlossaryTags: hits must be sorted by startIndex and non-overlapping", "Sort hits by startIndex and ensure they do not overlap before calling injectGlossaryTags");
    }
  }

  let result = "";
  let cursor = 0;

  for (const hit of hits) {
    result += text.slice(cursor, hit.startIndex);
    const sourcePart = text.slice(hit.startIndex, hit.endIndex);
    const translation = escapeAttr(hit.entry.targetTerm);
    if (!codeSwitch.includes(hit)) {
      result += `<term translation="${translation}">${escapeContent(sourcePart)}</term>`;
    } else {
      const source = sharesScript(sourcePart, hit.entry.targetTerm) ? "" : ` source="${escapeAttr(sourcePart)}"`;
      result += `<term translation="${translation}"${source}>${escapeContent(hit.entry.targetTerm)}</term>`;
    }
    cursor = hit.endIndex;
  }

  result += text.slice(cursor);
  return result;
}

function unescapeAttr(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

const OPEN_QUOTES = `"'«“„‘‹`;
const CLOSE_QUOTES = `"'»”“’›`;
const SENTINEL_TERM_RE = new RegExp(`^${PLACEHOLDER_SENTINEL_PREFIX}\\d+${PLACEHOLDER_SENTINEL_SUFFIX}$`);
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordCount = (s: string): number => s.split(/\s+/).length;

/**
 * The model's own inflected form of glossary term `term` written inside a
 * complete term tag, or undefined when the tag is to be replaced by the term.
 * The inner text (trimmed, one pair of surrounding quotes dropped) is kept when
 * it contains the term case-insensitively and has no more words than the term:
 * ar `الكوميت` / `انشر` for `كوميت` / `نشر`, fr `hôtes` for `hôte`. The matched
 * part is written as the term itself, so the output always contains it exactly.
 * Placeholder sentinel tags always become the attribute.
 */
export function keptTermForm(inner: string, term: string): string | undefined {
  if (!term.trim() || SENTINEL_TERM_RE.test(term)) return undefined;
  let word = inner.trim();
  if (word.length >= 2 && OPEN_QUOTES.includes(word[0]) && CLOSE_QUOTES.includes(word[word.length - 1])) {
    word = word.slice(1, -1).trim();
  }
  if (/[<>]/.test(word) || wordCount(word) > wordCount(term.trim())) return undefined;
  const match = new RegExp(escapeRegExp(term), "iu").exec(word);
  if (!match) return undefined;
  return word.slice(0, match.index) + term + word.slice(match.index + match[0].length);
}

/**
 * Strip all <term ...>...</term> tags from text.
 * - Complete tags: replace with the translation attribute value (what injectGlossaryTags wrote),
 *   unless the inner text is the model's own inflected form of that term (see keptTermForm),
 *   which is kept. Otherwise the model echoed the tag with its own word inside; the glossary
 *   requires the attribute's term, not that word. Tags without a translation attribute keep
 *   their inner content.
 * - Unclosed tags (model didn't emit </term>): extract the translation attribute value.
 * - Any remaining bare <term ...> opening tags: remove.
 */
export function stripGlossaryTags(text: string): string {
  // Complete tags: <term translation="X">content</term> → X (or the model's form of X)
  let result = removeTermTags(text, true);
  // Unclosed tags: <term translation="X">... → X (use translation attribute)
  result = result.replace(/<term\s+translation="([^"]*)"[^>]*>[^<]*/g, (_m, attr: string) => unescapeAttr(attr));
  // Any remaining bare opening tags
  result = removeTermTags(result, false);
  return result;
}

/**
 * Same result as replacing /<term[^>]*>(.*?)<\/term>/gs with keptTermForm("$1", attribute)
 * or else the opening tag's translation attribute (else "$1") (withClose) or /<term[^>]*>/g
 * with "" (!withClose), in linear time. Those regexes rescan
 * to the end of the text from every unclosed "<term", which is quadratic.
 */
function removeTermTags(text: string, withClose: boolean): string {
  let result = "";
  let cursor = 0;

  for (;;) {
    const open = text.indexOf("<term", cursor);
    if (open === -1) break;
    const openEnd = text.indexOf(">", open);
    if (openEnd === -1) break;
    let next = openEnd + 1;
    let inner = "";
    if (withClose) {
      const close = text.indexOf("</term>", next);
      if (close === -1) break;
      inner = text.slice(next, close);
      const attr = /\btranslation="([^"]*)"/.exec(text.slice(open, openEnd));
      if (attr) {
        const term = unescapeAttr(attr[1]);
        inner = keptTermForm(inner, term) ?? term;
      }
      next = close + "</term>".length;
    }
    result += text.slice(cursor, open) + inner;
    cursor = next;
  }

  result += text.slice(cursor);
  return result;
}

/**
 * Normalize whitespace: collapse multiple spaces within lines, preserve newlines, trim.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

function stripCombiningMarks(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
}

/**
 * Compute glossary coverage ratio and list of missing source terms.
 * Returns { glossaryCoverage: 1, missingTerms: [] } when there are no hits.
 */
export function computeGlossaryCoverage(
  hits: GlossaryHit[],
  translated: string
): { glossaryCoverage: number; missingTerms: string[] } {
  if (hits.length === 0) return { glossaryCoverage: 1, missingTerms: [] };
  const normalizedTranslated = stripCombiningMarks(translated);
  const uniqueTerms = [...new Set(hits.map((h) => h.entry.sourceTerm))];
  const missingTerms = uniqueTerms.filter((sourceTerm) => {
    const targetTerm = hits.find((h) => h.entry.sourceTerm === sourceTerm)!.entry.targetTerm;
    return !normalizedTranslated.includes(stripCombiningMarks(targetTerm));
  });
  return {
    glossaryCoverage: (uniqueTerms.length - missingTerms.length) / uniqueTerms.length,
    missingTerms,
  };
}
