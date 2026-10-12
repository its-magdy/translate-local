import type { Adapter, TranslationRequest, TranslationResult, GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { injectGlossaryTags, stripGlossaryTags, keptTermForm, normalizeWhitespace, computeGlossaryCoverage } from "@translate-local/shared/utils/text";
import { TlError, cancelledError } from "@translate-local/shared/errors";
import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "@translate-local/shared/constants";
import { matchTerms, type GlossaryStore } from "./glossary";
import { fixTermAgreement } from "./agreement";

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

  const retryLimit = glossaryMode === "strict" ? maxRetries : PREFER_RETRIES;
  let retries = 0;
  let glossaryReminder: TranslationRequest["glossaryReminder"];
  // Prefer mode returns the attempt with the highest coverage; ties keep the earlier one.
  let best: TranslationResult | undefined;
  // Whether `best` holds a term forced into the output (see `forced` below).
  let bestForced = false;

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
    // A target term the model did not choose itself: the code-switched source
    // put it there, or the model echoed a term tag around its own word and the
    // tag strip below swaps in the term (a tag around the model's own form of
    // the term keeps that form, so it is not forced). The words around it may still agree
    // with the model's word, so such a result gets an agreement repair.
    const forced = codeSwitched || substitutesTerm(raw.translated, targetTerms);

    const translated = fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw.translated)), targetLang, targetTerms);
    const { glossaryCoverage, missingTerms } = computeGlossaryCoverage(realHits, translated);
    const result: TranslationResult = {
      ...raw,
      translated,
      glossaryCoverage,
      missingTerms,
      metadata: { ...raw.metadata, retries },
    };

    if (missingTerms.length === 0) return forced ? repairAgreement(result) : result;
    if (!best || glossaryCoverage > best.glossaryCoverage) {
      best = result;
      bestForced = forced;
    }

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

    const final = { ...best, metadata: { ...best.metadata, retries } };
    return bestForced ? repairAgreement(final) : final;
  }

  /**
   * One extra model call that fixes only the grammar around the glossary terms
   * in `draft`. The repair is kept only when every term the draft has and every
   * placeholder sentinel survive and the length barely changes; otherwise, or
   * when the call fails, the draft is returned. A cancellation still throws.
   */
  async function repairAgreement(draft: TranslationResult): Promise<TranslationResult> {
    const terms = [...new Set(realHits.filter((h) => !draft.missingTerms.includes(h.entry.sourceTerm)).map((h) => h.entry.targetTerm))];
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
    const repaired = fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw.translated)), targetLang, targetTerms);
    const coverage = computeGlossaryCoverage(realHits, repaired);
    const ratio = repaired.length / draft.translated.length;
    const accepted =
      repaired !== draft.translated &&
      coverage.missingTerms.every((term) => draft.missingTerms.includes(term)) &&
      sentinels(repaired) === sentinels(draft.translated) &&
      ratio <= REPAIR_MAX_LENGTH_RATIO &&
      ratio >= 1 / REPAIR_MAX_LENGTH_RATIO;
    if (!accepted) return draft;
    return { ...draft, translated: repaired, ...coverage, metadata: { ...draft.metadata, repaired: true } };
  }
}

/**
 * Whether the raw output has a term tag for one of `targetTerms` around a
 * different word, which stripGlossaryTags then replaces with the term. A
 * complete tag around the model's own form of the term (keptTermForm) keeps
 * that form, so it is no substitution.
 */
function substitutesTerm(raw: string, targetTerms: string[]): boolean {
  for (const match of raw.matchAll(OUTPUT_TAG_RE)) {
    const [tag, attr, inner] = match;
    // The term exactly as the strip writes it (attribute unescaped).
    const term = stripGlossaryTags(`<term translation="${attr}"></term>`);
    if (!targetTerms.includes(term)) continue;
    const closed = raw.startsWith("</term>", match.index + tag.length);
    if (closed ? keptTermForm(inner, term) === undefined : inner.trim() !== term) return true;
  }
  return false;
}

/** The placeholder sentinels in `text`, sorted, as one comparable string. */
function sentinels(text: string): string {
  return (text.match(SENTINEL_RE) ?? []).sort().join(" ");
}
