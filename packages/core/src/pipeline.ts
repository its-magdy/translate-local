import type { Adapter, TranslationRequest, TranslationResult } from "@translate-local/shared/types";
import { injectGlossaryTags, stripGlossaryTags, normalizeWhitespace, computeGlossaryCoverage } from "@translate-local/shared/utils/text";
import { TlError } from "@translate-local/shared/errors";
import type { GlossaryStore } from "./glossary";

import type { GlossaryHit } from "@translate-local/shared/types";

export interface PipelineOptions {
  glossaryMode?: "strict" | "prefer";
  maxRetries?: number;
  contextSnippets?: string[];
  imageBase64?: string;
  onChunk?: (chunk: string) => void;
  /** Caller-supplied glossary hits merged with the in-pipeline lookup. */
  extraGlossaryHits?: GlossaryHit[];
}

export async function runPipeline(
  text: string,
  sourceLang: string,
  targetLang: string,
  adapter: Adapter,
  glossaryStore: GlossaryStore,
  options: PipelineOptions = {},
): Promise<TranslationResult> {
  const { glossaryMode = "prefer", maxRetries = 2, contextSnippets = [], imageBase64, onChunk, extraGlossaryHits = [] } = options;
  const isImageMode = !!imageBase64;

  const realHits = isImageMode ? [] : glossaryStore.findMatches(text, sourceLang, targetLang);
  const hits = [...realHits, ...extraGlossaryHits].sort((a, b) => a.startIndex - b.startIndex);
  const taggedSource = hits.length > 0 ? injectGlossaryTags(text, hits) : text;

  let retries = 0;
  let missingHint: string | undefined;

  while (true) {
    const source = isImageMode ? "" : (missingHint ? `${taggedSource}\n\n[Note: ${missingHint}]` : taggedSource);
    const request: TranslationRequest = {
      source,
      sourceLang,
      targetLang,
      imageBase64,
      glossaryHits: hits,
      contextSnippets,
      // Stream on first attempt only — retries silent to avoid concatenating partial outputs.
      onChunk: retries === 0 ? onChunk : undefined,
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
      missingHint = `Ensure these terms appear in the translation: ${missingTerms.join(", ")}`;
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
