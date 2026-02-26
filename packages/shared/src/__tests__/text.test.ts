import { describe, test, expect } from "bun:test";
import { injectGlossaryTags, stripGlossaryTags, normalizeWhitespace } from "../utils/text";
import type { GlossaryHit } from "../types";

function makeHit(sourceTerm: string, targetTerm: string, startIndex: number): GlossaryHit {
  return {
    entry: {
      id: "1",
      sourceTerm,
      targetTerm,
      sourceLang: "en",
      targetLang: "ar",
    },
    startIndex,
    endIndex: startIndex + sourceTerm.length,
  };
}

describe("injectGlossaryTags", () => {
  test("wraps matched term in XML tag", () => {
    const result = injectGlossaryTags("Use the API here", [makeHit("API", "واجهة", 8)]);
    expect(result).toBe('Use the <term translation="واجهة">API</term> here');
  });

  test("handles no hits", () => {
    expect(injectGlossaryTags("Hello", [])).toBe("Hello");
  });

  test("handles multiple hits in order", () => {
    const text = "The API and Cloud";
    const hits = [makeHit("API", "واجهة", 4), makeHit("Cloud", "سحابة", 12)];
    const result = injectGlossaryTags(text, hits);
    expect(result).toBe('The <term translation="واجهة">API</term> and <term translation="سحابة">Cloud</term>');
  });

  test("escapes quotes in targetTerm attribute", () => {
    const result = injectGlossaryTags("Use API", [makeHit("API", 'val"ue', 4)]);
    expect(result).toBe('Use <term translation="val&quot;ue">API</term>');
  });

  test("escapes & and < > in targetTerm attribute", () => {
    const result = injectGlossaryTags("Use API", [makeHit("API", "a&b<c>d", 4)]);
    expect(result).toBe('Use <term translation="a&amp;b&lt;c&gt;d">API</term>');
  });

  test("escapes & and < > in source text content", () => {
    const text = "Use A&B here";
    const result = injectGlossaryTags(text, [makeHit("A&B", "target", 4)]);
    expect(result).toBe('Use <term translation="target">A&amp;B</term> here');
  });

  test("escapes < > in source text content", () => {
    const text = "Use A<B here";
    const result = injectGlossaryTags(text, [makeHit("A<B", "target", 4)]);
    expect(result).toBe('Use <term translation="target">A&lt;B</term> here');
  });

  test("throws on out-of-order hits", () => {
    const hits = [makeHit("Cloud", "سحابة", 8), makeHit("API", "واجهة", 4)];
    expect(() => injectGlossaryTags("The API and Cloud", hits)).toThrow();
  });
});

describe("stripGlossaryTags", () => {
  test("removes term tags keeping inner content", () => {
    const input = 'Use the <term translation="واجهة">API</term> here';
    expect(stripGlossaryTags(input)).toBe("Use the API here");
  });

  test("handles text without tags", () => {
    expect(stripGlossaryTags("Hello world")).toBe("Hello world");
  });

  test("removes multiple tags", () => {
    const input = '<term translation="a">X</term> and <term translation="b">Y</term>';
    expect(stripGlossaryTags(input)).toBe("X and Y");
  });

  test("strips tags when inner content spans a newline", () => {
    const input = '<term translation="a">line one\nline two</term>';
    expect(stripGlossaryTags(input)).toBe("line one\nline two");
  });

  test("uses translation attribute for unclosed tags", () => {
    const input = 'prefix <term translation="مرحبا">hello';
    expect(stripGlossaryTags(input)).toBe("prefix مرحبا");
  });

  test("handles multiple unclosed tags", () => {
    // Space after "machine learning" is consumed as part of the source content — normalizeWhitespace handles the rest
    const input = '<term translation="تعلم الآلة">machine learning<term translation="شبكة عصبية">neural network';
    expect(stripGlossaryTags(input)).toBe("تعلم الآلةشبكة عصبية");
  });
});

describe("normalizeWhitespace", () => {
  test("collapses multiple spaces", () => {
    expect(normalizeWhitespace("hello   world")).toBe("hello world");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  hello  ")).toBe("hello");
  });

  test("preserves newlines", () => {
    expect(normalizeWhitespace("hello\n\nworld")).toBe("hello\n\nworld");
  });
});
