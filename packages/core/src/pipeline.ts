import type { Adapter, TranslationRequest, TranslationResult, AdapterResponse, GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { TlError, cancelledError } from "@translate-local/shared/errors";
import { PLACEHOLDER_SENTINEL_PREFIX, PLACEHOLDER_SENTINEL_SUFFIX } from "@translate-local/shared/constants";
import { matchTerms, type GlossaryStore } from "./glossary";
import { appendsEndPunctuation } from "./punctuation";
import { TermSet, type KeptWords } from "./terms";

/**
 * Retries prefer mode makes for a missed glossary term (strict uses maxRetries):
 * one with a reminder, then the code-switched final retry.
 */
const PREFER_RETRIES = 2;

/** A repaired text may be at most this many times longer or shorter than the draft. */
const REPAIR_MAX_LENGTH_RATIO = 1.3;

const SENTINEL_RE = new RegExp(`${PLACEHOLDER_SENTINEL_PREFIX}\\d+${PLACEHOLDER_SENTINEL_SUFFIX}`, "g");

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
  const terms = new TermSet(text, realHits, extraGlossaryHits, targetLang, isImageMode);

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
      source: isImageMode ? "" : codeSwitched ? terms.codeSwitchedSource : terms.taggedSource,
      sourceLang,
      targetLang,
      imageBase64,
      glossaryHits: terms.hits,
      contextSnippets,
      glossaryReminder: codeSwitched ? undefined : glossaryReminder,
      // Stream on first attempt only — retries silent to avoid concatenating partial outputs.
      onChunk: retries === 0 ? onChunk : undefined,
      signal,
      options: { glossaryMode },
    };

    const raw = await adapter.translate(request);
    if (codeSwitched) codeSwitchedRaw = raw.translated;
    const reading = terms.read(raw.translated);
    const result: TranslationResult = {
      translated: reading.translated, sourceLang, targetLang, glossaryCoverage: reading.glossaryCoverage, missingTerms: reading.missingTerms,
      glossaryTerms: terms.count, metadata: { ...raw.metadata, retries },
    };
    // A target term the model did not choose itself: the code-switched source
    // put it there, or the model echoed a term tag around its own word, which
    // the tag strip swapped for the term (see Reading.forced). The words around
    // it may still agree with the model's word, so such a result gets an
    // agreement repair.
    const attempt: Attempt = { raw: raw.translated, result, forced: codeSwitched || reading.forced, codeSwitched };
    const { missingTerms } = result;

    if (missingTerms.length === 0) return finish(attempt);
    if (!best || result.glossaryCoverage > best.result.glossaryCoverage) best = attempt;

    if (retries < retryLimit) {
      // missingTerms are source terms; the model needs their target translations.
      glossaryReminder = terms.reminder(missingTerms);
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

  /** The attempt to return, after the tag and drift checks and, for a forced term, the agreement repair. */
  async function finish(attempt: Attempt): Promise<TranslationResult> {
    let { result, forced } = attempt;
    // The code-switched attempt was already sent the check's source.
    const candidates: KeptWords = attempt.codeSwitched ? new Map() : terms.tagCheckCandidates(attempt.raw);
    const drift: KeptWords = attempt.codeSwitched ? new Map() : terms.driftCandidates(attempt.raw);
    if (candidates.size > 0 || drift.size > 0) {
      // Prefer mode's code-switched retry already sent the check's source: reuse its output.
      let check = codeSwitchedRaw;
      if (check === undefined) {
        check = await tagCheckCall();
        result = { ...result, metadata: { ...result.metadata, tagChecked: true } };
      }
      // The check still writes the words a tag drifted onto: they translate other source
      // words, which the strip would drop. Its output, which places the term itself, is the
      // answer, if it covers every term the draft does and keeps its placeholders.
      if (check !== undefined && terms.drifted(drift, check)) {
        const reading = terms.read(check);
        if (reading.missingTerms.every((term) => result.missingTerms.includes(term)) && sentinels(reading.translated) === sentinels(result.translated)) {
          return repairAgreement({
            ...result, translated: reading.translated, glossaryCoverage: reading.glossaryCoverage, missingTerms: reading.missingTerms,
            metadata: { ...result.metadata, tagDrift: true },
          });
        }
      }
      const kept = check === undefined ? new Map() : terms.keptWords(candidates, check);
      if (kept.size > 0) {
        // The term stays covered by its occurrence outside the tags; coverage is recomputed anyway.
        const reading = terms.read(attempt.raw, kept);
        result = {
          ...result, translated: reading.translated, glossaryCoverage: reading.glossaryCoverage, missingTerms: reading.missingTerms,
          metadata: { ...result.metadata, keptWord: true },
        };
        forced = reading.forced;
      }
    }
    return forced ? repairAgreement(result) : result;
  }

  /**
   * The tag check's extra model call: the code-switched source (the target
   * terms in place of the source words, as the last glossary retry sends it).
   * A candidate's word (tagCheckCandidates) the model still writes there
   * translates another source word, so the tag strip keeps it; a drifted span
   * (driftCandidates) it still writes makes its output the answer. Undefined
   * when the call fails; a cancellation still throws.
   */
  async function tagCheckCall(): Promise<string | undefined> {
    if (signal?.aborted) throw cancelledError();
    try {
      return (await adapter.translate({ source: terms.codeSwitchedSource, sourceLang, targetLang, glossaryHits: terms.hits, signal, options: { glossaryMode } })).translated;
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
    const repairTerms = terms.repairTerms(draft);
    if (repairTerms.length === 0) return draft;
    if (signal?.aborted) throw cancelledError();
    let raw: AdapterResponse;
    try {
      raw = await adapter.translate({ source: draft.translated, sourceLang, targetLang, repairTerms, signal, options: { glossaryMode } });
    } catch (err) {
      if (err instanceof TlError && err.tag === "CANCELLED") throw err;
      if (signal?.aborted) throw cancelledError(err);
      return draft;
    }
    const { translated: repaired, glossaryCoverage, missingTerms } = terms.read(raw.translated);
    const ratio = repaired.length / draft.translated.length;
    const accepted =
      repaired !== draft.translated &&
      missingTerms.every((term) => draft.missingTerms.includes(term)) &&
      sentinels(repaired) === sentinels(draft.translated) &&
      // The proofreading prompt sometimes bolds the term (`**الكاش**`).
      count(repaired, "*") <= count(draft.translated, "*") &&
      !appendsEndPunctuation(draft.translated, repaired, text) &&
      ratio <= REPAIR_MAX_LENGTH_RATIO &&
      ratio >= 1 / REPAIR_MAX_LENGTH_RATIO;
    if (!accepted) return draft;
    return { ...draft, translated: repaired, glossaryCoverage, missingTerms, metadata: { ...draft.metadata, repaired: true } };
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

/** How many times `char` occurs in `text`. */
function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** The placeholder sentinels in `text`, sorted, as one comparable string. */
function sentinels(text: string): string {
  return (text.match(SENTINEL_RE) ?? []).sort().join(" ");
}
