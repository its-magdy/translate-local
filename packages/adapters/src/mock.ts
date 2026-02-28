import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";
import { computeGlossaryCoverage } from "@tl/shared/utils/text";

/**
 * Deterministic mock adapter for testing.
 * Returns a predictable translation: "[{targetLang}] {source}"
 * Honours glossary hits by substituting terms in the output.
 */
export class MockAdapter implements Adapter {
  readonly name = "mock";

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();

    let translated = request.imageBase64
      ? `[image] ${request.source}`
      : `[${request.targetLang}] ${request.source}`;

    // Substitute glossary terms so tests can verify glossary enforcement
    const hits = request.glossaryHits ?? [];
    for (const hit of hits) {
      translated = translated.replace(hit.entry.sourceTerm, hit.entry.targetTerm);
    }

    const { glossaryCoverage, missingTerms } = computeGlossaryCoverage(hits, translated);

    return {
      translated,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      glossaryCoverage,
      missingTerms,
      metadata: {
        adapter: this.name,
        durationMs: Date.now() - start,
        retries: 0,
      },
    };
  }

  async dispose(): Promise<void> {
    // no-op
  }
}
