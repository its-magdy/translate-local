import type { Adapter, TranslationRequest, AdapterResponse } from "@translate-local/shared/types";
import { cancelledError } from "@translate-local/shared/errors";
import { injectGlossaryTags, stripGlossaryTags } from "@translate-local/shared/utils/text";

const TERM_TAG_RE = /<term translation="[^"]*">([^<]*)<\/term>/g;
// A code-switched tag: [, source attribute].
const CODE_SWITCHED_TAG_RE = /<term translation="[^"]*" source="([^"]*)">[^<]*<\/term>/g;

/**
 * Deterministic mock adapter for testing.
 * Returns a predictable translation: "[{targetLang}] {source}"
 * Honours glossary hits by substituting terms in the output.
 *
 * Test hook for a glossary miss: with `ignoreGlossary` (or the env var
 * TL_MOCK_IGNORE_GLOSSARY=1, read once at construction) the mock behaves like a
 * model that disregards every glossary tag, so each attempt misses: it emits
 * the source term even when the pipeline's code-switched retry puts the
 * target term inside the tag. Placeholder sentinels survive.
 */
export class MockAdapter implements Adapter {
  readonly name = "mock";
  private readonly ignoreGlossary: boolean;

  constructor(options: { ignoreGlossary?: boolean } = {}) {
    this.ignoreGlossary = options.ignoreGlossary ?? process.env.TL_MOCK_IGNORE_GLOSSARY === "1";
  }

  async translate(request: TranslationRequest): Promise<AdapterResponse> {
    if (request.signal?.aborted) throw cancelledError();
    const start = Date.now();

    let translated = request.repairTerms
      ? request.source
      : request.imageBase64
        ? `[image] ${request.source}`
        : `[${request.targetLang}] ${request.source}`;

    if (request.repairTerms) {
      // Agreement repair: the draft is returned unchanged (nothing to fix).
    } else if (this.ignoreGlossary) {
      // A code-switched tag holds the target term: put the source word back,
      // from the source attribute when there is one (the strip unescapes it),
      // else the entry's sourceTerm (<term translation="T">T</term>). Then keep
      // the inner text of every other tag; the pipeline would turn an echoed
      // tag into its translation.
      translated = translated.replace(CODE_SWITCHED_TAG_RE, (_m, source: string) => stripGlossaryTags(`<term translation="${source}"></term>`));
      for (const { entry } of request.glossaryHits ?? []) {
        const t = entry.targetTerm;
        translated = translated.split(injectGlossaryTags(t, [{ entry, startIndex: 0, endIndex: t.length }])).join(entry.sourceTerm);
      }
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
      metadata: { adapter: this.name, durationMs: Date.now() - start },
    };
  }

  async dispose(): Promise<void> {
    // no-op
  }
}
