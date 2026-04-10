import { describe, test, expect } from "bun:test";
import { MockAdapter } from "../mock";
import type { GlossaryEntry, GlossaryHit, TranslationRequest } from "@translate-local/shared/types";

const makeRequest = (overrides?: Partial<TranslationRequest>): TranslationRequest => ({
  source: "Hello world",
  sourceLang: "en",
  targetLang: "ar",
  ...overrides,
});

describe("MockAdapter", () => {
  test("returns deterministic translation", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest());
    expect(result.translated).toBe("[ar] Hello world");
    expect(result.sourceLang).toBe("en");
    expect(result.targetLang).toBe("ar");
  });

  test("metadata includes adapter name and retries=0", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest());
    expect(result.metadata.adapter).toBe("mock");
    expect(result.metadata.retries).toBe(0);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("glossaryCoverage is 1 when no hits", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest());
    expect(result.glossaryCoverage).toBe(1);
    expect(result.missingTerms).toHaveLength(0);
  });

  test("substitutes glossary terms and reports full coverage", async () => {
    const entry: GlossaryEntry = {
      id: "1",
      sourceTerm: "world",
      targetTerm: "عالم",
      sourceLang: "en",
      targetLang: "ar",
    };
    const hit: GlossaryHit = { entry, startIndex: 6, endIndex: 11 };
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest({ glossaryHits: [hit] }));
    expect(result.translated).toContain("عالم");
    expect(result.glossaryCoverage).toBe(1);
    expect(result.missingTerms).toHaveLength(0);
  });

  test("returns [image] prefix when imageBase64 is set", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest({ imageBase64: "abc123", source: "label" }));
    expect(result.translated).toBe("[image] label");
  });

  test("dispose resolves without error", async () => {
    const adapter = new MockAdapter();
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});
