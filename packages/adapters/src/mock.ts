import type { Adapter, TranslationRequest, TranslationResult } from "@translate-local/shared/types";
import { cancelledError } from "@translate-local/shared/errors";

const TERM_TAG_RE = /<term translation="[^"]*">([^<]*)<\/term>/g;

/**
 * Deterministic mock adapter for testing.
 * Returns a predictable translation: "[{targetLang}] {source}"
 * Honours glossary hits by substituting terms in the output.
 *
 * Test hook for a glossary miss: with `ignoreGlossary` (or the env var
 * TL_MOCK_IGNORE_GLOSSARY=1, read once at construction) the mock behaves like a
 * model that disregards every glossary tag, so each attempt misses.
 */
export class MockAdapter implements Adapter {
  readonly name = "mock";
  private readonly ignoreGlossary: boolean;

  constructor(options: { ignoreGlossary?: boolean } = {}) {
    this.ignoreGlossary = options.ignoreGlossary ?? process.env.TL_MOCK_IGNORE_GLOSSARY === "1";
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.signal?.aborted) throw cancelledError();
    const start = Date.now();

    let translated = request.imageBase64
      ? `[image] ${request.source}`
      : `[${request.targetLang}] ${request.source}`;

    if (this.ignoreGlossary) {
      // Keep the source word inside each <term> tag. The pipeline would
      // otherwise turn an echoed tag into its translation attribute.
      translated = translated.replace(TERM_TAG_RE, "$1");
    } else {
      // Substitute glossary terms so tests can verify glossary enforcement
      const hits = request.glossaryHits ?? [];
      for (const hit of hits) {
        translated = translated.replace(hit.entry.sourceTerm, hit.entry.targetTerm);
      }
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
