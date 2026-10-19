import type { GlossaryHit } from "../types";
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

/** `inner` trimmed, with one pair of surrounding quotes dropped. */
function unquote(inner: string): string {
  const word = inner.trim();
  return word.length >= 2 && OPEN_QUOTES.includes(word[0]) && CLOSE_QUOTES.includes(word[word.length - 1]) ? word.slice(1, -1).trim() : word;
}

/**
 * `term` with its first letter raised (`hôte` → `Hôte`) when it has no uppercase
 * letter at all; otherwise `term` unchanged, so `iOS` or `Zweig` keep their casing.
 */
export function capitalizeTerm(term: string): string {
  return /\p{Lu}/u.test(term) ? term : term.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

/** Separates the parts of a split form (`stellen … bereit`): an ellipsis or three dots. */
const FORM_GAP_RE = /…|\.\.\./;

/**
 * The parts of glossary form `form`: two or more for a split form (`stellen … bereit`
 * → `stellen`, `bereit`), else one. Only `forms` are split; a target term with an
 * ellipsis (`Speichern unter…`) is never a split form.
 */
export function formParts(form: string): string[] {
  const parts = form.split(FORM_GAP_RE).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [form];
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
 * When an all-caps match (`HÔTES`) is rewritten as the term, the letters glued
 * after it are lowercased too (`hôtes`, not `hôteS`); text before it or after a
 * non-letter stays as written (`L'HÔTE` → `L'hôte`, `IOS-APPS` → `iOS-APPS`).
 * A rewritten all-caps match that starts the word is written as
 * `capitalizeTerm(term)` when the tag is at a sentence start (`atSentenceStart`,
 * see stripGlossaryTags): `HÔTES sont prêts` → `Hôtes sont prêts`.
 * Placeholder sentinel tags always become the attribute.
 */
export function keptTermForm(inner: string, term: string, forms: readonly string[] = [], atSentenceStart = false): string | undefined {
  if (!term.trim() || SENTINEL_TERM_RE.test(term)) return undefined;
  const word = unquote(inner);
  if (/[<>]/.test(word)) return undefined;
  for (const candidate of [term, ...contiguousForms(forms)]) {
    if (!candidate.trim() || wordCount(word) > wordCount(candidate.trim())) continue;
    const match = new RegExp(escapeRegExp(candidate), "iu").exec(word);
    if (!match) continue;
    const kept = match[0] === capitalizeTerm(candidate);
    const end = match.index + match[0].length;
    const tail = /^[\p{L}\p{M}]*/u.exec(word.slice(end))![0];
    if (kept || /\p{Ll}/u.test(match[0] + tail)) return word.slice(0, match.index) + (kept ? match[0] : candidate) + word.slice(end);
    // All caps: lowercase the glued tail together with the match, so context-dependent
    // mappings hold (Greek final sigma: `ΧΡΉΣΤΗΣ` → `χρήστης`). Without the target locale,
    // Turkish `I` / `İ` lowercase as elsewhere (`i`, `i̇`), not as `ı` / `i`.
    const lower = (match[0] + tail).toLowerCase();
    const matchLower = match[0].toLowerCase();
    const lowerTail = lower.startsWith(matchLower) ? lower.slice(matchLower.length) : tail.toLowerCase();
    const form = atSentenceStart && match.index === 0 ? capitalizeTerm(candidate) : candidate;
    return word.slice(0, match.index) + form + lowerTail + word.slice(end + tail.length);
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
 *   (fr `<term translation="hôte">Serveur</term> : détails` → `Hôte : détails`). A tag whose
 *   term `kept` maps to exactly its inner text (the pipeline's tag check, see
 *   tagCheckCandidates) keeps that text as written. Tags without
 *   a translation attribute keep their inner content.
 * - Unclosed tags (model didn't emit </term>): extract the translation attribute value.
 * - Any remaining bare <term ...> opening tags: remove.
 */
export function stripGlossaryTags(text: string, forms?: ReadonlyMap<string, readonly string[]>, kept?: ReadonlyMap<string, string>): string {
  // Complete tags: <term translation="X">content</term> → X (or the model's form of X)
  let result = removeTermTags(text, true, forms, kept);
  // Unclosed tags: <term translation="X">... → X (use translation attribute)
  result = result.replace(UNCLOSED_TAG_RE, (_m, attr: string) => unescapeAttr(attr));
  // Any remaining bare opening tags
  result = removeTermTags(result, false);
  return result;
}

const UNCLOSED_TAG_RE = /<term\s+translation="([^"]*)"(?:\s+[a-z]+="[^"]*")*>[^<]*/g;

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
 * or else ("$1" when `kept` maps the attribute to exactly "$1") the opening tag's
 * translation attribute, capitalized at a sentence start as
 * stripGlossaryTags describes (else "$1") (withClose) or /<term[^>]*>/g
 * with "" (!withClose), in linear time. Those regexes rescan
 * to the end of the text from every unclosed "<term", which is quadratic.
 */
function removeTermTags(text: string, withClose: boolean, forms?: ReadonlyMap<string, readonly string[]>, kept?: ReadonlyMap<string, string>): string {
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
        inner = keptTermForm(inner, term, forms?.get(term), sentence.atStart()) ?? (kept?.get(term) === inner ? inner : capitalize ? capitalizeTerm(term) : term);
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
 * A finder for whole word `part` (or `capitalizeTerm(part)`): where it first
 * occurs in a text at or after `from`, as [start, end], or undefined. An edge of
 * `part` that is not a spaced-script word character (CJK, punctuation) is not
 * checked, as in core's glossary matcher.
 */
function wordFinder(part: string): (text: string, from: number) => [number, number] | undefined {
  const checkStart = isWordChar(part.codePointAt(0));
  const checkEnd = isWordChar([...part].at(-1)?.codePointAt(0));
  const variants = [...new Set([part, capitalizeTerm(part)])];
  return (text, from) => {
    let best: [number, number] | undefined;
    for (const p of variants) {
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
  };
}

const SENTENCE_END = ".!?。！？؟।";

/**
 * `text` split into sentences for split forms, in one linear scan: at a line
 * break, or after `.!?` (and their CJK, Arabic and Devanagari forms) plus
 * whitespace before a character that is not lowercase. Not after a one-letter
 * word, so abbreviations like `z. B.` don't split, and not after `…`, which
 * elides inside a sentence as often as it ends one.
 */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i));
      start = i + 1;
      continue;
    }
    if (!SENTENCE_END.includes(text[i])) continue;
    if (/\p{L}/u.test(text[i - 1] ?? "") && (i < 2 || /[\s.]/.test(text[i - 2]))) continue;
    let j = i + 1;
    while (j < text.length && text[j] !== "\n" && /\s/.test(text[j])) j++;
    if (j === i + 1 || j === text.length || /\p{Ll}/u.test(String.fromCodePoint(text.codePointAt(j)!))) continue;
    out.push(text.slice(start, i + 1));
    start = j;
    i = j - 1;
  }
  out.push(text.slice(start));
  return out;
}

/**
 * Which of glossary target `term` and its other `forms` `text` contains: the
 * first that matches, or undefined. Combining marks are dropped on both sides.
 * The term and one-piece forms count as substrings, as written or with the first
 * letter capitalized (capitalizeTerm), so inflected targets still count. A split
 * form (`stellen … bereit`) counts when each part occurs as a whole word, in
 * order, within one sentence (see `sentences`).
 */
export function foundForm(text: string, term: string, forms: readonly string[] = []): string | undefined {
  return findForm(text, term, forms, false);
}

/** foundForm, with the term and one-piece forms as whole words when `wholeWord` (see wordFinder). */
function findForm(text: string, term: string, forms: readonly string[], wholeWord: boolean): string | undefined {
  const plain = stripCombiningMarks(text);
  const contains = wholeWord
    ? (s: string) => wordFinder(s)(plain, 0) !== undefined
    : (s: string) => plain.includes(s) || plain.includes(capitalizeTerm(s));
  if (contains(stripCombiningMarks(term))) return term;
  let split: string[] | undefined;
  return forms.find((form) => {
    const parts = formParts(stripCombiningMarks(form));
    if (parts.length === 1) return contains(parts[0]);
    const finders = parts.map(wordFinder);
    return (split ??= sentences(plain)).some((sentence) => {
      let at = 0;
      for (const find of finders) {
        const found = find(sentence, at);
        if (!found) return false;
        at = found[1];
      }
      return true;
    });
  });
}

/** A letter of a script written without spaces between words. */
const NO_SPACE_RE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]/u;

/** The unescaped translation attribute of opening tag `openTag`, if any. */
function termAttr(openTag: string): string | undefined {
  const attr = /\btranslation="([^"]*)"/.exec(openTag);
  return attr ? unescapeAttr(attr[1]) : undefined;
}

/**
 * The complete term tags of model output `raw` that get the pipeline's tag
 * check: a tag for real glossary target term T around a word X that
 * keptTermForm rejects (so the strip would replace X with T) while T or one of
 * its `forms` occurs outside every tag as a whole word (foundForm with word
 * edges checked, so `hôtel` is not `hôte`), as in de
 * `<term translation="bereitstellen">Automatisch</term> nach jedem Commit
 * bereitstellen.`: the model may have placed the term itself and tagged a word
 * that translates another source word. Returned as T → the tag's inner text
 * exactly as written (what stripGlossaryTags' `kept` takes).
 *
 * Only for a T with exactly one of `hits` (the real glossary hits) and exactly
 * one tag in `raw`: with two source occurrences, T outside the tags may
 * translate the other one. Not for placeholder sentinels, an X with no letter
 * or with `<`/`>`, or an X that is the hit's source word (an untranslated
 * leak, `<term …>Deploy</term>`). Never when X, T or a form has a CJK, kana,
 * Thai, Lao, Khmer or Myanmar letter: with no word edges to check, T could be
 * part of another word (`キー` in `キーボード`), and X too. Outside excludes all the strip replaces:
 * complete tags, and an unclosed tag with the text after it. Linear in `raw`
 * per distinct term of `hits`.
 */
export function tagCheckCandidates(raw: string, hits: readonly GlossaryHit[], forms?: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  return new Map(replacedTags(raw, hits, forms).filter((t) => t.outside).map((t) => [t.term, t.inner]));
}

/**
 * The complete term tags of model output `raw` that get the pipeline's drift
 * check: a tag for real glossary target term T around a span X that
 * keptTermForm rejects, while neither T nor a form occurs outside every tag
 * (where tagCheckCandidates doesn't look), and X has more words than the hit's
 * source term, as in fr `<term translation="antémémoire">Taux de réussite</term>`
 * for `Cache hit rate`: the tag drifted onto the words around the term, which
 * the strip would replace. A one-word X for a one-word source term is most
 * often the model's own word for it (`serveur` for `hôte`), which the strip
 * replaces rightly. Same limits as tagCheckCandidates (one hit, one tag, no
 * sentinel, source word or no-space script). Returned as T → the tag's inner
 * text exactly as written.
 */
export function driftCandidates(raw: string, hits: readonly GlossaryHit[], forms?: ReadonlyMap<string, readonly string[]>): Map<string, string> {
  return new Map(replacedTags(raw, hits, forms).filter((t) => !t.outside && wordCount(unquote(t.inner)) > wordCount(t.sourceTerm.trim())).map((t) => [t.term, t.inner]));
}

/**
 * The complete tags of `raw` for a real term T (one of `hits`, exactly one hit
 * and one tag) around a word keptTermForm rejects, with whether T or a form is
 * outside every tag as a whole word: what tagCheckCandidates and driftCandidates
 * choose from.
 */
function replacedTags(raw: string, hits: readonly GlossaryHit[], forms?: ReadonlyMap<string, readonly string[]>): { term: string; inner: string; sourceTerm: string; outside: boolean }[] {
  const found: { term: string; inner: string; sourceTerm: string; outside: boolean }[] = [];
  const sources = new Map<string, string[]>();
  for (const { entry } of hits) sources.set(entry.targetTerm, [...(sources.get(entry.targetTerm) ?? []), entry.sourceTerm]);
  if (sources.size === 0) return found;
  const tagCount = new Map<string, number>();
  const count = (term: string | undefined) => {
    if (term !== undefined) tagCount.set(term, (tagCount.get(term) ?? 0) + 1);
  };
  const tags: [term: string, inner: string][] = [];
  let outside = "";
  let cursor = 0;
  // Complete tags, paired as removeTermTags pairs them.
  for (;;) {
    const open = raw.indexOf("<term", cursor);
    if (open === -1) break;
    const openEnd = raw.indexOf(">", open);
    if (openEnd === -1) break;
    const close = raw.indexOf("</term>", openEnd + 1);
    if (close === -1) break;
    const term = termAttr(raw.slice(open, openEnd));
    count(term);
    if (term !== undefined) tags.push([term, raw.slice(openEnd + 1, close)]);
    // A NUL where the tag was, so the term can't match across it.
    outside += raw.slice(cursor, open) + "\0";
    cursor = close + "</term>".length;
  }
  const rest = raw.slice(cursor);
  for (let open = rest.indexOf("<term"); open !== -1; ) {
    const openEnd = rest.indexOf(">", open);
    if (openEnd === -1) break;
    count(termAttr(rest.slice(open, openEnd)));
    open = rest.indexOf("<term", openEnd + 1);
  }
  // The strip replaces an unclosed tag and the text after it; leftover opening tags go too.
  outside = removeTermTags((outside + rest).replace(UNCLOSED_TAG_RE, "\0"), false);

  const fold = (s: string) => stripCombiningMarks(s).toLowerCase();
  for (const [term, inner] of tags) {
    const termSources = sources.get(term);
    if (termSources?.length !== 1 || tagCount.get(term) !== 1 || SENTINEL_TERM_RE.test(term)) continue;
    const word = unquote(inner);
    if (!/\p{L}/u.test(word) || /[<>]/.test(word) || fold(word) === fold(termSources[0])) continue;
    const termForms = forms?.get(term) ?? [];
    if ([word, term, ...termForms].some((s) => NO_SPACE_RE.test(s))) continue;
    if (keptTermForm(inner, term, termForms) !== undefined) continue;
    found.push({ term, inner, sourceTerm: termSources[0], outside: findForm(outside, term, termForms, true) !== undefined });
  }
  return found;
}

/**
 * The tag check's decision for a tagCheckCandidates entry (term T, tag inner
 * `inner`): keep the model's word X only when `check`, the model's output for
 * the code-switched source (T in place of the glossary source word), has T or
 * one of its `forms` and X, each as a whole word (X case-insensitively), after
 * the tag strip with combining marks dropped. An X that is a part of one of
 * T's split forms is never kept. X then translates another source word;
 * when the model wrote X for the glossary source word, the check's tag strip
 * puts T there and X is gone. X is looked for outside every occurrence of T
 * and its one-piece forms (any case), so a part of a multi-word term does not
 * count (`Request` in `Pull Request`). Word edges are checked as for split
 * forms (not at a punctuation edge).
 */
export function checkKeepsWord(check: string, term: string, inner: string, forms?: ReadonlyMap<string, readonly string[]>): boolean {
  const stripped = stripGlossaryTags(check, forms);
  const termForms = forms?.get(term) ?? [];
  if (findForm(stripped, term, termForms, true) === undefined) return false;
  const fold = (s: string) => stripCombiningMarks(s).toLowerCase();
  // A part of a split form (`Stellen` of `stellen … bereit`) is the term itself.
  const word = fold(unquote(inner));
  if (termForms.some((form) => formParts(form).length > 1 && formParts(form).some((part) => fold(part) === word))) return false;
  // Longest first, so a form inside another is blanked with it.
  const spans = [term, ...contiguousForms(termForms)].map(fold).filter(Boolean).sort((a, b) => b.length - a.length);
  // A NUL where T was, as tagCheckCandidates blanks tags (split/join: linear, no regex).
  const rest = spans.reduce((text, span) => text.split(span).join("\0"), fold(stripped));
  return wordFinder(word)(rest, 0) !== undefined;
}

/** Arabic harakat (fathatan … sukun), which the model adds or drops at will. */
const HARAKAT_RE = /[\u064B-\u0652]/g;

/** The maximal runs of spaced-script word characters in `text` (see isWordChar), in one scan. */
function wordTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of text) {
    if (isWordChar(ch.codePointAt(0))) {
      current += ch;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * The drift check's decision for a driftCandidates entry (term T, tag inner
 * `inner`): whether `check`, the model's output for the code-switched source,
 * still writes the drifted span X, so X translated other source words and the
 * check's output (which places T itself) is the better answer. X counts when,
 * after the tag strip and outside every occurrence of T and its one-piece
 * `forms`, the check has X, or at least half of X's distinct words (runs of
 * word characters, so `Commit-Operation` is two) of four or more characters
 * that are not inside T or a placeholder, as whole words, case-insensitively (fr
 * `antémémoire : taille` for X `Taille de la mémoire cache :`; one stray
 * `Ihre` or `الآن` doesn't make `Ihre Daten im Archiv` count). Text is NFC-
 * normalized and only Arabic harakat are dropped: Latin accents are kept, so
 * `archive` is not the verb `archivé`.
 */
export function checkWritesDriftedWord(check: string, term: string, inner: string, forms?: ReadonlyMap<string, readonly string[]>): boolean {
  const fold = (s: string) => s.normalize("NFC").replace(HARAKAT_RE, "").toLowerCase();
  const spans = [term, ...contiguousForms(forms?.get(term) ?? [])].map(fold).filter(Boolean).sort((a, b) => b.length - a.length);
  // A NUL where T was, as checkKeepsWord blanks it (split/join: linear, no regex).
  const rest = spans.reduce((text, span) => text.split(span).join("\0"), fold(stripGlossaryTags(check, forms)));
  const span = fold(unquote(inner));
  if (span.length > 0 && wordFinder(span)(rest, 0) !== undefined) return true;
  // The check's words once, as a set: one search per word of X would be quadratic.
  const written = new Set(wordTokens(rest));
  const sentinel = PLACEHOLDER_SENTINEL_PREFIX.toLowerCase();
  const words = [...new Set(wordTokens(span))].filter((w) => [...w].length >= 4 && !fold(term).includes(w) && !w.startsWith(sentinel));
  return words.length > 0 && 2 * words.filter((w) => written.has(w)).length >= words.length;
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
  const missingTerms = uniqueTerms.filter((sourceTerm) => {
    const { targetTerm } = hits.find((h) => h.entry.sourceTerm === sourceTerm)!.entry;
    // Forms belong to the target word: every entry with this target lends its own.
    const forms = hits.flatMap((h) => (h.entry.targetTerm === targetTerm ? (h.entry.forms ?? []) : []));
    return foundForm(translated, targetTerm, forms) === undefined;
  });
  return {
    glossaryCoverage: (uniqueTerms.length - missingTerms.length) / uniqueTerms.length,
    missingTerms,
  };
}
