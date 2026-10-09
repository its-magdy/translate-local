import type { Adapter, TranslationRequest, TranslationResult, GlossaryEntry, GlossaryHit } from "@translate-local/shared/types";
import { injectGlossaryTags, stripGlossaryTags, normalizeWhitespace, computeGlossaryCoverage } from "@translate-local/shared/utils/text";
import { TlError, cancelledError } from "@translate-local/shared/errors";
import { matchTerms, type GlossaryStore } from "./glossary";

export interface PipelineOptions {
  glossaryMode?: "strict" | "prefer";
  maxRetries?: number;
  contextSnippets?: string[];
  imageBase64?: string;
  onChunk?: (chunk: string) => void;
  /** Forwarded to every attempt; once aborted, no further attempt starts (throws CANCELLED). */
  signal?: AbortSignal;
  /** Caller-supplied glossary hits merged with the in-pipeline lookup. */
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

  let retries = 0;
  let glossaryReminder: TranslationRequest["glossaryReminder"];

  while (true) {
    if (signal?.aborted) throw cancelledError();
    const request: TranslationRequest = {
      source: isImageMode ? "" : taggedSource,
      sourceLang,
      targetLang,
      imageBase64,
      glossaryHits: hits,
      contextSnippets,
      glossaryReminder,
      // Stream on first attempt only — retries silent to avoid concatenating partial outputs.
      onChunk: retries === 0 ? onChunk : undefined,
      signal,
      options: { glossaryMode },
    };

    const raw = await adapter.translate(request);

    const translated = normalizeWhitespace(stripGlossaryTags(raw.translated));
    const { glossaryCoverage, missingTerms } = computeGlossaryCoverage(hits, translated);
    const result: TranslationResult = {
      ...raw,
      translated,
      glossaryCoverage,
      missingTerms,
      metadata: { ...raw.metadata, retries },
    };

    if (missingTerms.length === 0) return result;

    if (glossaryMode === "strict" && retries < maxRetries) {
      // missingTerms are source terms; the model needs their target translations.
      glossaryReminder = missingTerms.map((term) => ({
        source: term,
        target: hits.find((h) => h.entry.sourceTerm === term)!.entry.targetTerm,
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

    return result;
  }
}
