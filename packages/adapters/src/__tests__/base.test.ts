import { describe, test, expect } from "bun:test";
import { buildStructuredPrompt, buildNaturalPrompt } from "../base";
import type { GlossaryEntry, GlossaryHit, TranslationRequest } from "@tl/shared/types";

const baseRequest: TranslationRequest = {
  source: "The API is ready.",
  sourceLang: "en",
  targetLang: "ar",
};

const makeHit = (sourceTerm: string, targetTerm: string): GlossaryHit => ({
  entry: {
    id: "1",
    sourceTerm,
    targetTerm,
    sourceLang: "en",
    targetLang: "ar",
  } satisfies GlossaryEntry,
  startIndex: 4,
  endIndex: 4 + sourceTerm.length,
});

describe("buildStructuredPrompt", () => {
  test("includes source and target lang in prompt", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt).toContain("English");
    expect(prompt).toContain("Arabic");
  });

  test("includes source text", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt).toContain("The API is ready.");
  });

  test("does not inject XML tags itself (tag injection is handled by preprocessor)", () => {
    // Actual tag injection (e.g. <term translation="x">source</term>) is done upstream by injectGlossaryTags.
    // The prompt may mention the tag format as an instruction, but should not wrap the actual source text in tags.
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).not.toContain('translation="واجهة برمجة"');
  });

  test("includes context snippets when provided", () => {
    const req = { ...baseRequest, contextSnippets: ["This is a software project."] };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).toContain("This is a software project.");
  });

  test("does not include Source: or Translation: labels (BUG-006)", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt).not.toContain("Source:");
    expect(prompt).not.toContain("Translation:");
  });

  test("ends with source text as last line (BUG-006)", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt.trimEnd()).toEndWith("The API is ready.");
  });

  test("includes glossary tag instruction in prompt when glossary hits present", () => {
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).toContain('<term translation=');
  });

  test("system is undefined (all instructions go in prompt for TranslateGemma)", () => {
    const { system } = buildStructuredPrompt(baseRequest);
    expect(system).toBeUndefined();
  });

  test("image mode: uses vision preamble and does not append source text", () => {
    const req: TranslationRequest = { ...baseRequest, imageBase64: "abc123" };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).toContain("Extract all text from the image");
    expect(prompt).not.toContain("The API is ready.");
  });

  test("image mode: does not include XML tag instruction", () => {
    const req: TranslationRequest = { ...baseRequest, imageBase64: "abc123", glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).not.toContain('<term translation=');
  });
});

describe("buildNaturalPrompt", () => {
  test("includes professional translator instruction", () => {
    const prompt = buildNaturalPrompt(baseRequest);
    expect(prompt).toContain("professional translator");
  });

  test("includes glossary term mappings", () => {
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const prompt = buildNaturalPrompt(req);
    expect(prompt).toContain('"API" → "واجهة برمجة"');
  });

  test("includes source text", () => {
    const prompt = buildNaturalPrompt(baseRequest);
    expect(prompt).toContain("The API is ready.");
  });
});
