import { describe, it, expect } from "vitest";
import { formatResultMarkdown } from "../src/lib/format";
import type { TlTranslateResult } from "../src/lib/types";

function makeResult(overrides: Partial<TlTranslateResult> = {}): TlTranslateResult {
  return {
    translated: "مرحبا",
    sourceLang: "en",
    targetLang: "ar",
    glossaryCoverage: 0.85,
    missingTerms: [],
    metadata: { adapter: "translate-gemma", durationMs: 150, retries: 0 },
    ...overrides,
  };
}

describe("formatResultMarkdown", () => {
  it("includes translated text", () => {
    const md = formatResultMarkdown(makeResult());
    expect(md).toContain("مرحبا");
  });

  it("includes duration", () => {
    const md = formatResultMarkdown(makeResult({ metadata: { adapter: "mock", durationMs: 42, retries: 0 } }));
    expect(md).toContain("42ms");
  });

  it("includes glossary coverage percentage", () => {
    const md = formatResultMarkdown(makeResult({ glossaryCoverage: 0.85 }));
    expect(md).toContain("85%");
  });

  it("shows missing terms section when there are missing terms", () => {
    const md = formatResultMarkdown(makeResult({ missingTerms: ["API", "endpoint"] }));
    expect(md).toContain("Missing Glossary Terms");
    expect(md).toContain("API");
    expect(md).toContain("endpoint");
  });

  it("omits missing terms section when empty", () => {
    const md = formatResultMarkdown(makeResult({ missingTerms: [] }));
    expect(md).not.toContain("Missing Glossary Terms");
  });
});
