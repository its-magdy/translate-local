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

  test("includes glossary instruction when hits present", () => {
    const req = { ...baseRequest, glossaryHits: [makeHit("API", "واجهة برمجة")] };
    const prompt = buildStructuredPrompt(req);
    expect(prompt).toContain("<term>");
  });

  test("no glossary instruction without hits", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).not.toContain("<term>");
  });

  test("includes context snippets when provided", () => {
    const req = { ...baseRequest, contextSnippets: ["This is a software project."] };
    const prompt = buildStructuredPrompt(req);
    expect(prompt).toContain("This is a software project.");
  });

  test("ends with Translation: marker", () => {
    const prompt = buildStructuredPrompt(baseRequest);
    expect(prompt).toContain("Translation:");
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
