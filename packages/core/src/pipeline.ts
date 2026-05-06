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
  /** When provided, skip the in-pipeline glossary lookup and use these hits directly.
   * Used by file-translate to inject synthetic hits that protect masked placeholders. */
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

  // Preprocess: skip glossary tag injection for images (can't tag pixels)
  const realHits = isImageMode ? [] : glossaryStore.findMatches(text, sourceLang, targetLang);
  // Merge real glossary hits with caller-supplied synthetic hits (e.g. placeholder-preservation hits from file mode).
  // Sort by startIndex; throw if overlapping (caller's responsibility to ensure non-overlap).
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
      // Only stream on the first attempt; retries are silent to avoid concatenating
      // partial output from attempt N with tokens from attempt N+1.
      onChunk: retries === 0 ? onChunk : undefined,
      options: { glossaryMode },
    };

    const raw = await adapter.translate(request);

    // Postprocess: strip tags and normalize
    const translated = normalizeWhitespace(stripGlossaryTags(raw.translated));

    // Validate glossary coverage
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
