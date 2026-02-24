import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";
import { injectGlossaryTags, stripGlossaryTags, normalizeWhitespace, computeGlossaryCoverage } from "@tl/shared/utils/text";
import { TlError } from "@tl/shared/errors";
import type { GlossaryStore } from "./glossary";

export interface PipelineOptions {
  glossaryMode?: "strict" | "prefer";
  maxRetries?: number;
  contextSnippets?: string[];
}

export async function runPipeline(
  text: string,
  sourceLang: string,
  targetLang: string,
  adapter: Adapter,
  glossaryStore: GlossaryStore,
  options: PipelineOptions = {},
): Promise<TranslationResult> {
  const { glossaryMode = "prefer", maxRetries = 2, contextSnippets = [] } = options;

  // Preprocess: find glossary hits and inject tags
  const hits = glossaryStore.findMatches(text, sourceLang, targetLang);
  const taggedSource = hits.length > 0 ? injectGlossaryTags(text, hits) : text;

  let retries = 0;
  let missingHint: string | undefined;

  while (true) {
    const source = missingHint ? `${taggedSource}\n\n[Note: ${missingHint}]` : taggedSource;
    const request: TranslationRequest = {
      source,
      sourceLang,
      targetLang,
      glossaryHits: hits,
      contextSnippets,
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
