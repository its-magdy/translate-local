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
  test("includes source and target lang", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).toContain("en");
    expect(prompt).toContain("ar");
  });

  test("includes source text", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).toContain("The API is ready.");
  });

  test("does not include glossary instruction (deferred to preprocessor)", () => {
    // XML tag injection is handled by the Phase 3 preprocessor, not the prompt builder
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const prompt = buildStructuredPrompt(req);
    expect(prompt).not.toContain("<term>");
  });

  test("includes context snippets when provided", () => {
    const req = { ...baseRequest, contextSnippets: ["This is a software project."] };
    const prompt = buildStructuredPrompt(req);
    expect(prompt).toContain("This is a software project.");
  });

  test("does not include Source: or Translation: labels (BUG-006)", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).not.toContain("Source:");
    expect(prompt).not.toContain("Translation:");
  });

  test("ends with source text as last line (BUG-006)", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt.trimEnd()).toEndWith("The API is ready.");
  });

  test("includes term tag instruction when glossary hits provided (BUG-007)", () => {
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const prompt = buildStructuredPrompt(req);
    expect(prompt).toContain("Preserve terms marked with <term> tags");
  });

  test("does not include term tag instruction when no glossary hits", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).not.toContain("Preserve terms");
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
