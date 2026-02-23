import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";

/**
 * Deterministic mock adapter for testing.
 * Returns a predictable translation: "[{targetLang}] {source}"
 * Honours glossary hits by substituting terms in the output.
 */
export class MockAdapter implements Adapter {
  readonly name = "mock";

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();

    let translated = `[${request.targetLang}] ${request.source}`;

    // Substitute glossary terms so tests can verify glossary enforcement
    const hits = request.glossaryHits ?? [];
    for (const hit of hits) {
      translated = translated.replace(hit.entry.sourceTerm, hit.entry.targetTerm);
    }

    const missingTerms = hits
      .filter((h) => !translated.includes(h.entry.targetTerm))
      .map((h) => h.entry.sourceTerm);

    const glossaryCoverage =
      hits.length === 0 ? 1 : (hits.length - missingTerms.length) / hits.length;

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
