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
  });

  test("metadata includes adapter name and duration", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest());
    expect(result.metadata.adapter).toBe("mock");
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("substitutes glossary terms", async () => {
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
  });

  test("returns [image] prefix when imageBase64 is set", async () => {
    const adapter = new MockAdapter();
    const result = await adapter.translate(makeRequest({ imageBase64: "abc123", source: "label" }));
    expect(result.translated).toBe("[image] label");
  });

  test("throws CANCELLED for an already-aborted signal", async () => {
    const adapter = new MockAdapter();
    await expect(adapter.translate(makeRequest({ signal: AbortSignal.abort() }))).rejects.toMatchObject({ tag: "CANCELLED" });
  });

  test("returns an agreement repair request's text unchanged", async () => {
    for (const adapter of [new MockAdapter(), new MockAdapter({ ignoreGlossary: true })]) {
      const result = await adapter.translate(makeRequest({ source: "مرحبا عالم", repairTerms: ["عالم"] }));
      expect(result.translated).toBe("مرحبا عالم");
    }
  });

  test("dispose resolves without error", async () => {
    const adapter = new MockAdapter();
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

describe("MockAdapter ignoreGlossary hook", () => {
  const tagged = '<term translation="عالم">world</term>';
  const entry: GlossaryEntry = { id: "1", sourceTerm: "world", targetTerm: "عالم", sourceLang: "en", targetLang: "ar" };
  const request = makeRequest({
    source: `Hello ${tagged}`,
    glossaryHits: [{ entry, startIndex: 6, endIndex: 11 }],
  });

  test("keeps the source word inside the term tag instead of the target", async () => {
    const result = await new MockAdapter({ ignoreGlossary: true }).translate(request);
    expect(result.translated).toBe("[ar] Hello world");
  });

  test("emits the source term for a code-switched tag holding the target", async () => {
    const source = 'Hello <term translation="عالم" source="World &amp; co">عالم</term>';
    const result = await new MockAdapter({ ignoreGlossary: true }).translate({ ...request, source });
    expect(result.translated).toBe("[ar] Hello World & co");
    // A same-script code-switched tag has no source attribute: the entry's sourceTerm comes back.
    const plain = 'Hello <term translation="عالم">عالم</term>';
    expect((await new MockAdapter({ ignoreGlossary: true }).translate({ ...request, source: plain })).translated).toBe("[ar] Hello world");
  });

  test("does not touch tags whose inner text is a sentinel", async () => {
    const source = '<term translation="__TLPH_0__">__TLPH_0__</term> and <term translation="عالم">world</term>';
    const result = await new MockAdapter({ ignoreGlossary: true }).translate(makeRequest({ source }));
    expect(result.translated).toBe("[ar] __TLPH_0__ and world");
  });

  test("is off by default", async () => {
    const result = await new MockAdapter().translate(request);
    expect(result.translated).toContain("عالم");
  });

  test("TL_MOCK_IGNORE_GLOSSARY=1 turns it on at construction; the option overrides the env", async () => {
    const saved = process.env.TL_MOCK_IGNORE_GLOSSARY;
    process.env.TL_MOCK_IGNORE_GLOSSARY = "1";
    try {
      const fromEnv = new MockAdapter();
      const overridden = new MockAdapter({ ignoreGlossary: false });
      expect((await fromEnv.translate(request)).translated).toBe("[ar] Hello world");
      expect((await overridden.translate(request)).translated).toContain("عالم");
    } finally {
      if (saved === undefined) delete process.env.TL_MOCK_IGNORE_GLOSSARY;
      else process.env.TL_MOCK_IGNORE_GLOSSARY = saved;
    }
  });
});
