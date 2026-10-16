import type { Adapter, TranslationRequest, TranslationResult, GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { injectGlossaryTags, stripGlossaryTags, keptTermForm, normalizeWhitespace, computeGlossaryCoverage, stripCombiningMarks, foundForm, formParts, contiguousForms, tagCheckCandidates, checkKeepsWord } from "@translate-local/shared/utils/text";
import { TlError, cancelledError } from "@translate-local/shared/errors";
import { langFallbackChain } from "@translate-local/shared/utils/language";
import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "@translate-local/shared/constants";
import { matchTerms, type GlossaryStore } from "./glossary";
import { arabicLamMerge, escapeRegExp, fixTermAgreement } from "./agreement";

/**
 * Retries prefer mode makes for a missed glossary term (strict uses maxRetries):
 * one with a reminder, then the code-switched final retry.
 */
const PREFER_RETRIES = 2;

/** A repaired text may be at most this many times longer or shorter than the draft. */
const REPAIR_MAX_LENGTH_RATIO = 1.3;

const SENTINEL_RE = new RegExp(`${PLACEHOLDER_SENTINEL_PREFIX}\\d+${PLACEHOLDER_SENTINEL_SUFFIX}`, "g");
// A term tag in model output, closed or not: [, translation attribute, inner text].
// Doesn't match code-switched tags with a source attribute; that attempt counts as forced anyway.
const OUTPUT_TAG_RE = /<term\s+translation="([^"]*)">([^<]*)/g;

export interface PipelineOptions {
  glossaryMode?: "strict" | "prefer";
  /** Strict mode only: prefer mode always makes PREFER_RETRIES (2) retries. */
  maxRetries?: number;
  contextSnippets?: string[];
  imageBase64?: string;
  onChunk?: (chunk: string) => void;
  /** Forwarded to every attempt; once aborted, no further attempt starts (throws CANCELLED). */
  signal?: AbortSignal;
  /**
   * Caller-supplied hits tagged in the source alongside the glossary lookup's
   * (file mode routes placeholder sentinels through this). They are for tagging
   * only: glossary retries (both modes), glossaryReminder, glossaryCoverage and
   * missingTerms count real glossary hits alone, so the caller must check that
   * these survived itself.
   */
  extraGlossaryHits?: GlossaryHit[];
  /**
   * Pre-fetched glossary entries to match against. When provided, the pipeline
   * matches in-process instead of calling glossaryStore.findMatches (which would
   * re-query SQLite per call). Use this when running the pipeline in a hot loop.
   */
  glossaryEntries?: GlossaryEntry[];
}

export async function runPipeline(
  text: string,
  sourceLang: string,
  targetLang: string,
  adapter: Adapter,
  glossaryStore: GlossaryStore,
  options: PipelineOptions = {},
): Promise<TranslationResult> {
  const { glossaryMode = "prefer", maxRetries = 2, contextSnippets = [], imageBase64, onChunk, signal, extraGlossaryHits = [], glossaryEntries } = options;
  const isImageMode = !!imageBase64;

  const realHits = isImageMode
    ? []
    : glossaryEntries
      ? matchTerms(text, glossaryEntries)
      : glossaryStore.findMatches(text, sourceLang, targetLang);
  const hits = [...realHits, ...extraGlossaryHits].sort((a, b) => a.startIndex - b.startIndex);
  const taggedSource = hits.length > 0 ? injectGlossaryTags(text, hits) : text;
  const codeSwitchedSource = realHits.length > 0 ? injectGlossaryTags(text, hits, realHits) : taggedSource;
  // Real hits only: placeholder sentinels need no agreement fix-up.
  const targetTerms = [...new Set(realHits.map((h) => h.entry.targetTerm))];
  // Each target term's other forms, which the tag strip keeps like the term.
  const forms = new Map<string, string[]>();
  for (const { entry } of realHits) forms.set(entry.targetTerm, [...new Set([...(forms.get(entry.targetTerm) ?? []), ...(entry.forms ?? [])])]);
  // Fix-ups and the Arabic coverage split also apply to the one-piece forms.
  const agreementTerms = [...new Set([...targetTerms, ...contiguousForms([...forms.values()].flat())])];

  const retryLimit = glossaryMode === "strict" ? maxRetries : PREFER_RETRIES;
  let retries = 0;
  let glossaryReminder: TranslationRequest["glossaryReminder"];
  // Prefer mode returns the attempt with the highest coverage; ties keep the earlier one.
  let best: Attempt | undefined;
  // The code-switched attempt's raw output, once it ran: the tag check's answer.
  let codeSwitchedRaw: string | undefined;

  while (true) {
    if (signal?.aborted) throw cancelledError();
    // The final retry sends the target terms in place of the source terms (a
    // term in another script than its source word keeps the word as a tag
    // attribute, so it keeps its meaning) and no reminder: the model then
    // writes the sentence around the term itself.
    const codeSwitched = retries > 0 && retries === retryLimit;
    const request: TranslationRequest = {
      source: isImageMode ? "" : codeSwitched ? codeSwitchedSource : taggedSource,
      sourceLang,
      targetLang,
      imageBase64,
      glossaryHits: hits,
      contextSnippets,
      glossaryReminder: codeSwitched ? undefined : glossaryReminder,
      // Stream on first attempt only — retries silent to avoid concatenating partial outputs.
      onChunk: retries === 0 ? onChunk : undefined,
      signal,
      options: { glossaryMode },
    };

    const raw = await adapter.translate(request);
    if (codeSwitched) codeSwitchedRaw = raw.translated;
    // A target term the model did not choose itself: the code-switched source
    // put it there, or the model echoed a term tag around its own word and the
    // tag strip below swaps in the term (a tag around the model's own form of
    // the term keeps that form, so it is not forced). The words around it may still agree
    // with the model's word, so such a result gets an agreement repair.
    const forced = codeSwitched || substitutesTerm(raw.translated, targetTerms, forms);

    const result: TranslationResult = { ...raw, ...postprocess(raw.translated), metadata: { ...raw.metadata, retries } };
    const attempt: Attempt = { raw: raw.translated, result, forced, codeSwitched };
    const { missingTerms } = result;

    if (missingTerms.length === 0) return finish(attempt);
    if (!best || result.glossaryCoverage > best.result.glossaryCoverage) best = attempt;

    if (retries < retryLimit) {
      // missingTerms are source terms; the model needs their target translations.
      glossaryReminder = missingTerms.map((term) => ({
        source: term,
        target: realHits.find((h) => h.entry.sourceTerm === term)!.entry.targetTerm,
      }));
      retries++;
      continue;
    }

    if (glossaryMode === "strict") {
      throw new TlError(
        "GLOSSARY_STRICT_MISS",
        `${missingTerms.length} glossary term(s) missing after ${retries} retries: ${missingTerms.join(", ")}`,
        "Use --glossary=prefer to allow partial matches",
      );
    }

    return finish({ ...best, result: { ...best.result, metadata: { ...best.result.metadata, retries } } });
  }

  /** Raw model output after the tag strip (keeping the `kept` words) and fix-ups, with its coverage. */
  function postprocess(raw: string, kept?: ReadonlyMap<string, string>) {
    const postprocessed = fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw, forms, kept)), targetLang, agreementTerms);
    const translated = isImageMode ? postprocessed : dropAddedFullStop(postprocessed, text, agreementTerms);
    return { translated, ...computeGlossaryCoverage(realHits, splitArabicArticles(translated, targetLang, agreementTerms)) };
  }

  /** The attempt to return, after the tag check and, for a forced term, the agreement repair. */
  async function finish(attempt: Attempt): Promise<TranslationResult> {
    let { result, forced } = attempt;
    // The code-switched attempt was already sent the check's source.
    const candidates = attempt.codeSwitched ? new Map<string, string>() : tagCheckCandidates(attempt.raw, realHits, forms);
    if (candidates.size > 0) {
      // Prefer mode's code-switched retry already sent the check's source: reuse its output.
      let check = codeSwitchedRaw;
      if (check === undefined) {
        check = await tagCheckCall();
        result = { ...result, metadata: { ...result.metadata, tagChecked: true } };
      }
      const kept = new Map([...candidates].filter(([term, inner]) => check !== undefined && checkKeepsWord(check, term, inner, forms)));
      if (kept.size > 0) {
        // The term stays covered by its occurrence outside the tags; coverage is recomputed anyway.
        result = { ...result, ...postprocess(attempt.raw, kept), metadata: { ...result.metadata, keptWord: true } };
        forced = substitutesTerm(attempt.raw, targetTerms, forms, kept);
      }
    }
    return forced ? repairAgreement(result) : result;
  }

  /**
   * The tag check's extra model call: the code-switched source (the target
   * terms in place of the source words, as the last glossary retry sends it),
   * whose output is never returned, only read by checkKeepsWord: a candidate's
   * word (tagCheckCandidates) the model still writes there translates another
   * source word, so the tag strip keeps it. Undefined when the call fails; a
   * cancellation still throws.
   */
  async function tagCheckCall(): Promise<string | undefined> {
    if (signal?.aborted) throw cancelledError();
    try {
      return (await adapter.translate({ source: codeSwitchedSource, sourceLang, targetLang, glossaryHits: hits, signal, options: { glossaryMode } })).translated;
    } catch (err) {
      if (err instanceof TlError && err.tag === "CANCELLED") throw err;
      if (signal?.aborted) throw cancelledError(err);
      return undefined;
    }
  }

  /**
   * One extra model call that fixes only the grammar around the glossary terms
   * in `draft`. The repair is kept only when every term the draft has and every
   * placeholder sentinel survive, no `*` is added and the length barely
   * changes; otherwise, or when the call fails, the draft is returned. A
   * cancellation still throws.
   */
  async function repairAgreement(draft: TranslationResult): Promise<TranslationResult> {
    // The form of each covered term the draft has (a split form's parts), which the repair must keep as written.
    const terms = [...new Set(realHits
      .filter((h) => !draft.missingTerms.includes(h.entry.sourceTerm))
      .flatMap((h) => {
        const found = foundForm(draft.translated, h.entry.targetTerm, forms.get(h.entry.targetTerm)) ?? h.entry.targetTerm;
        return found === h.entry.targetTerm ? [found] : formParts(found);
      }))];
    if (terms.length === 0) return draft;
    if (signal?.aborted) throw cancelledError();
    let raw: TranslationResult;
    try {
      raw = await adapter.translate({ source: draft.translated, sourceLang, targetLang, repairTerms: terms, signal, options: { glossaryMode } });
    } catch (err) {
      if (err instanceof TlError && err.tag === "CANCELLED") throw err;
      if (signal?.aborted) throw cancelledError(err);
      return draft;
    }
    const repaired = dropAddedFullStop(fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw.translated, forms)), targetLang, agreementTerms), text, agreementTerms);
    const coverage = computeGlossaryCoverage(realHits, splitArabicArticles(repaired, targetLang, agreementTerms));
    const ratio = repaired.length / draft.translated.length;
    const accepted =
      repaired !== draft.translated &&
      coverage.missingTerms.every((term) => draft.missingTerms.includes(term)) &&
      sentinels(repaired) === sentinels(draft.translated) &&
      // The proofreading prompt sometimes bolds the term (`**الكاش**`).
      count(repaired, "*") <= count(draft.translated, "*") &&
      !appendsEndPunctuation(draft.translated, repaired, text) &&
      ratio <= REPAIR_MAX_LENGTH_RATIO &&
      ratio >= 1 / REPAIR_MAX_LENGTH_RATIO;
    if (!accepted) return draft;
    return { ...draft, translated: repaired, ...coverage, metadata: { ...draft.metadata, repaired: true } };
  }
}

/** One translation attempt: raw model output, postprocessed result, and how it was made. */
interface Attempt {
  raw: string;
  result: TranslationResult;
  /** A term forced into the output (see `forced` in runPipeline). */
  forced: boolean;
  codeSwitched: boolean;
}

/**
 * Whether the raw output has a term tag for one of `targetTerms` around a
 * different word, which stripGlossaryTags then replaces with the term. A
 * complete tag around the model's own form of the term or of one of its
 * `forms` (keptTermForm), or around the word `kept` maps the term to (the tag
 * check), keeps that word, so it is no substitution.
 */
function substitutesTerm(raw: string, targetTerms: string[], forms: ReadonlyMap<string, readonly string[]>, kept?: ReadonlyMap<string, string>): boolean {
  for (const match of raw.matchAll(OUTPUT_TAG_RE)) {
    const [tag, attr, inner] = match;
    // The term exactly as the strip writes it (attribute unescaped).
    const term = stripGlossaryTags(`<term translation="${attr}"></term>`);
    if (!targetTerms.includes(term)) continue;
    const closed = raw.startsWith("</term>", match.index + tag.length);
    if (closed ? keptTermForm(inner, term, forms.get(term)) === undefined && kept?.get(term) !== inner : inner.trim() !== term) return true;
  }
  return false;
}

/**
 * Splits the Arabic `ل` + `ال` merge back apart (`للتوكن` → `لالتوكن`,
 * `للغة` → `لاللغة`) so the exact-substring coverage finds an `ال`-initial
 * term. The merge must not follow `ل` or `ا`, so the misspelt `لللغة` stays a
 * miss. Harakat are dropped first, as coverage drops them anyway, so `للّغة`
 * splits too. Coverage only: the returned text keeps the merge, which is
 * correct grammar (and what `fixTermAgreement()` writes).
 */
function splitArabicArticles(text: string, targetLang: string, terms: string[]): string {
  if (langFallbackChain(targetLang).at(-1) !== "ar") return text;
  text = stripCombiningMarks(text);
  for (const term of terms.map(stripCombiningMarks)) {
    if (!term.startsWith("ال")) continue;
    text = text.replace(new RegExp(`(?<![لا])${escapeRegExp(arabicLamMerge(term))}`, "gu"), "ل" + term);
  }
  return text;
}

/**
 * Whether `repaired` is `draft` plus sentence-final punctuation the source
 * lacks (`Supprimer cet hôte` → `Supprimer cet hôte.`). That fixes no
 * agreement and UI labels have none; it was 13 of the 56 applied repairs in
 * the file-mode bench, none of them otherwise useful.
 */
function appendsEndPunctuation(draft: string, repaired: string, source: string): boolean {
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
function dropAddedFullStop(translated: string, source: string, terms: string[]): string {
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

/** How many times `char` occurs in `text`. */
function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** The placeholder sentinels in `text`, sorted, as one comparable string. */
function sentinels(text: string): string {
  return (text.match(SENTINEL_RE) ?? []).sort().join(" ");
}
