import type { Adapter, TranslationRequest, TranslationResult } from "@translate-local/shared/types";

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

    return {
      translated,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      // Real coverage is computed by the pipeline on the postprocessed text.
      glossaryCoverage: 1,
      missingTerms: [],
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
