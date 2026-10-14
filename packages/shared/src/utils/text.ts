import type { GlossaryEntry, GlossaryHit } from "../types";
import { TlError } from "../errors";
import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "../constants";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const scriptRe = (names: string): RegExp => new RegExp(`[${names.split(" ").map((n) => `\\p{Script=${n}}`).join("")}]`, "u");
// Han and kana count as one writing system (Japanese mixes them).
const CJK_SCRIPT_RES = [scriptRe("Han Hiragana Katakana"), scriptRe("Hangul")];
const LATIN_RE = scriptRe("Latin");
// One class per writing system.
const SCRIPT_RES = [
  ...[
    "Latin", "Greek", "Cyrillic", "Armenian", "Georgian", "Hebrew", "Arabic", "Syriac", "Thaana", "Devanagari",
    "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai",
    "Lao", "Tibetan", "Myanmar", "Khmer", "Ethiopic",
  ].map(scriptRe),
  ...CJK_SCRIPT_RES,
];

/** Whether `a` and `b` have letters of a common writing system. */
function sharesScript(a: string, b: string): boolean {
  return SCRIPT_RES.some((re) => re.test(a) && re.test(b));
}

/**
 * Whether a code-switched tag gets the source word as an attribute: only for a
 * term in another writing system than the word, and not a CJK or Latin one.
 */
function keepsSourceWord(word: string, term: string): boolean {
  return !sharesScript(word, term) && !LATIN_RE.test(term) && !CJK_SCRIPT_RES.some((re) => re.test(term));
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
 * word is left out: the model would copy it (it `server` for `host`). So is
 * one for a Han, kana or Hangul term: there the attribute bought no term
 * coverage and cost placeholders (ja `キャッシュ`: kept 29/60 vs 42/60). And
 * one for a Latin-script term: the model translates the word itself (ja→en
 * `サーバー` for `host`: last retry wrote "server" 6/16, vs 0/18 without).
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
      const source = keepsSourceWord(sourcePart, hit.entry.targetTerm) ? ` source="${escapeAttr(sourcePart)}"` : "";
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
 * `term` with its first letter raised (`hôte` → `Hôte`) when it has no uppercase
 * letter at all; otherwise `term` unchanged, so `iOS` or `Zweig` keep their casing.
 */
export function capitalizeTerm(term: string): string {
  return /\p{Lu}/u.test(term) ? term : term.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

/** Separates the parts of a split form (`stellen … bereit`): an ellipsis or three dots. */
const FORM_GAP_RE = /\s*(?:…|\.\.\.)\s*/;

/** The parts of a split form (`stellen … bereit` → `stellen`, `bereit`); one part for any other form. */
function formParts(form: string): string[] {
  const parts = form.split(FORM_GAP_RE).filter((p) => p.trim());
  return parts.length > 0 ? parts : [form];
}

/**
 * Every target form that counts as glossary entry `entry`'s term: `targetTerm`
 * first, then its `forms`.
 */
export function termForms(entry: Pick<GlossaryEntry, "targetTerm" | "forms">): string[] {
  return [entry.targetTerm, ...(entry.forms ?? [])];
}

/** The forms of `forms` written as one piece (not split), which can stand in a term tag or take agreement fix-ups. */
export function contiguousForms(forms: readonly string[]): string[] {
  return forms.filter((f) => formParts(f).length === 1);
}

/**
 * The model's own inflected form of glossary term `term` written inside a
 * complete term tag, or undefined when the tag is to be replaced by the term.
 * The inner text (trimmed, one pair of surrounding quotes dropped) is kept when
 * it contains the term, or one of the entry's other contiguous `forms`,
 * case-insensitively and has no more words than it: ar `الكوميت` / `انشر` for
 * `كوميت` / `نشر`, fr `hôtes` for `hôte`, de `Bereitstellung` with that form.
 * The matched part is written as that form itself, or as `capitalizeTerm(form)`
 * when the model wrote it that way (de `Bereitstellen` for `bereitstellen`), so
 * the output always contains one of the two exactly (coverage accepts both).
 * Placeholder sentinel tags always become the attribute.
 */
export function keptTermForm(inner: string, term: string, forms: readonly string[] = []): string | undefined {
  if (!term.trim() || SENTINEL_TERM_RE.test(term)) return undefined;
  let word = inner.trim();
  if (word.length >= 2 && OPEN_QUOTES.includes(word[0]) && CLOSE_QUOTES.includes(word[word.length - 1])) {
    word = word.slice(1, -1).trim();
  }
  if (/[<>]/.test(word)) return undefined;
  for (const candidate of [term, ...contiguousForms(forms)]) {
    if (!candidate.trim() || wordCount(word) > wordCount(candidate.trim())) continue;
    const match = new RegExp(escapeRegExp(candidate), "iu").exec(word);
    if (!match) continue;
    const form = match[0] === capitalizeTerm(candidate) ? match[0] : candidate;
    return word.slice(0, match.index) + form + word.slice(match.index + match[0].length);
  }
  return undefined;
}

/**
 * Strip all <term ...>...</term> tags from text.
 * - Complete tags: replace with the translation attribute value (what injectGlossaryTags wrote),
 *   unless the inner text is the model's own inflected form of that term, or of one of its
 *   `forms` (keyed by target term; see keptTermForm), which is kept. Otherwise the model echoed the tag with its own word inside; the glossary
 *   requires the attribute's term, not that word. The term is capitalized (capitalizeTerm)
 *   when that word's first letter is uppercase and the tag starts the text, a line or a sentence
 *   (fr `<term translation="hôte">Serveur</term> : détails` → `Hôte : détails`). Tags without
 *   a translation attribute keep their inner content.
 * - Unclosed tags (model didn't emit </term>): extract the translation attribute value.
 * - Any remaining bare <term ...> opening tags: remove.
 */
export function stripGlossaryTags(text: string, forms?: ReadonlyMap<string, readonly string[]>): string {
  // Complete tags: <term translation="X">content</term> → X (or the model's form of X)
  let result = removeTermTags(text, true, forms);
  // Unclosed tags: <term translation="X">... → X (use translation attribute)
  result = result.replace(/<term\s+translation="([^"]*)"(?:\s+[a-z]+="[^"]*")*>[^<]*/g, (_m, attr: string) => unescapeAttr(attr));
  // Any remaining bare opening tags
  result = removeTermTags(result, false);
  return result;
}

/**
 * Tracks whether the output written so far ends at a sentence start: empty or
 * blank, after a line break, or after `.!?…` and whitespace. Fed segment by
 * segment, so the strip stays linear-time.
 */
function sentenceStartTracker(): { feed(segment: string): void; atStart(): boolean } {
  let last = "";
  let space = false;
  let newline = false;
  return {
    feed(segment) {
      const trimmed = segment.trimEnd();
      if (trimmed.length > 0) [last, space, newline] = [trimmed[trimmed.length - 1], false, false];
      const trailing = segment.slice(trimmed.length);
      if (trailing.length > 0) space = true;
      if (trailing.includes("\n")) newline = true;
    },
    atStart: () => last === "" || newline || (space && ".!?…".includes(last)),
  };
}

/**
 * Same result as replacing /<term[^>]*>(.*?)<\/term>/gs with keptTermForm("$1", attribute)
 * or else the opening tag's translation attribute, capitalized at a sentence start as
 * stripGlossaryTags describes (else "$1") (withClose) or /<term[^>]*>/g
 * with "" (!withClose), in linear time. Those regexes rescan
 * to the end of the text from every unclosed "<term", which is quadratic.
 */
function removeTermTags(text: string, withClose: boolean, forms?: ReadonlyMap<string, readonly string[]>): string {
  let result = "";
  let cursor = 0;
  const sentence = sentenceStartTracker();

  for (;;) {
    const open = text.indexOf("<term", cursor);
    if (open === -1) break;
    const openEnd = text.indexOf(">", open);
    if (openEnd === -1) break;
    let next = openEnd + 1;
    let inner = "";
    sentence.feed(text.slice(cursor, open));
    if (withClose) {
      const close = text.indexOf("</term>", next);
      if (close === -1) break;
      inner = text.slice(next, close);
      const attr = /\btranslation="([^"]*)"/.exec(text.slice(open, openEnd));
      if (attr) {
        const term = unescapeAttr(attr[1]);
        const capitalize = sentence.atStart() && /^\P{L}*\p{Lu}/u.test(inner);
        inner = keptTermForm(inner, term, forms?.get(term)) ?? (capitalize ? capitalizeTerm(term) : term);
      }
      next = close + "</term>".length;
    }
    result += text.slice(cursor, open) + inner;
    sentence.feed(inner);
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

/**
 * One word character of a space-delimited script, as in core's glossary matcher
 * (CJK, kana, Thai, Lao, Khmer and Myanmar have no word boundary to check).
 */
const SPACED_WORD_RE =
  /^[[\p{L}\p{N}\p{M}_\u200C\u200D]--[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]]$/v;
const isWordChar = (cp: number | undefined): boolean => cp !== undefined && SPACED_WORD_RE.test(String.fromCodePoint(cp));

/**
 * Where whole word `part` (or `capitalizeTerm(part)`) first occurs in `text` at or after
 * `from`, as [start, end], or undefined. An edge of `part` that is not a spaced-script word
 * character (CJK, punctuation) is not checked, as in core's glossary matcher.
 */
function findWord(text: string, part: string, from: number): [number, number] | undefined {
  const checkStart = isWordChar(part.codePointAt(0));
  const checkEnd = isWordChar(part.codePointAt(part.length - 1));
  let best: [number, number] | undefined;
  for (const p of new Set([part, capitalizeTerm(part)])) {
    for (let i = text.indexOf(p, from); i !== -1 && (!best || i < best[0]); i = text.indexOf(p, i + 1)) {
      // The code point ending at i: step back over a surrogate pair.
      const low = text.charCodeAt(i - 1);
      const before = i > 0 ? text.codePointAt(i - (low >= 0xdc00 && low <= 0xdfff && i >= 2 ? 2 : 1)) : undefined;
      if ((checkStart && isWordChar(before)) || (checkEnd && isWordChar(text.codePointAt(i + p.length)))) continue;
      best = [i, i + p.length];
      break;
    }
  }
  return best;
}

/**
 * The first of `forms` that `text` contains, or undefined. Combining marks are
 * dropped on both sides. A form counts as a substring, as the term itself or with
 * its first letter capitalized (capitalizeTerm), so inflected targets still count.
 * A split form (`stellen … bereit`) counts when each part occurs as a whole word,
 * in order, within one sentence.
 */
export function foundForm(text: string, forms: readonly string[]): string | undefined {
  const plain = stripCombiningMarks(text);
  return forms.find((form) => {
    const parts = formParts(stripCombiningMarks(form));
    if (parts.length === 1) return plain.includes(parts[0]) || plain.includes(capitalizeTerm(parts[0]));
    return plain.split(/(?<=[.!?…。！？؟])\s+|\n/u).some((sentence) => {
      let at = 0;
      for (const part of parts) {
        const found = findWord(sentence, part, at);
        if (!found) return false;
        at = found[1];
      }
      return true;
    });
  });
}

/** Drops combining marks (accents, Arabic harakat, hamza above/below) the way coverage compares text. */
export function stripCombiningMarks(s: string): string {
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
  const uniqueTerms = [...new Set(hits.map((h) => h.entry.sourceTerm))];
  const missingTerms = uniqueTerms.filter(
    (sourceTerm) => foundForm(translated, termForms(hits.find((h) => h.entry.sourceTerm === sourceTerm)!.entry)) === undefined,
  );
  return {
    glossaryCoverage: (uniqueTerms.length - missingTerms.length) / uniqueTerms.length,
    missingTerms,
  };
}
