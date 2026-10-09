import { describe, test, expect } from "bun:test";
import { injectGlossaryTags, stripGlossaryTags, normalizeWhitespace, computeGlossaryCoverage } from "../utils/text";
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

  test("matches the original regex implementation on random tag soup", () => {
    const regexStrip = (text: string) =>
      text
        .replace(/<term[^>]*>(.*?)<\/term>/gs, "$1")
        .replace(/<term\s+translation="([^"]*)">[^<]*/g, "$1")
        .replace(/<term[^>]*>/g, "");
    const pieces = ['<term translation="t">', "<term", "<term ", ">", "</term>", "</term", '"', "a", " ", "\n", "<b>"];
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      let input = "";
      for (let j = rand(12); j > 0; j--) input += pieces[rand(pieces.length)];
      expect(stripGlossaryTags(input)).toBe(regexStrip(input));
    }
  });

  test("runs in linear time on many unclosed tags", () => {
    const start = performance.now();
    stripGlossaryTags("<term>".repeat(100_000));
    stripGlossaryTags("<term".repeat(100_000));
    expect(performance.now() - start).toBeLessThan(1000);
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

describe("computeGlossaryCoverage", () => {
  test("returns full coverage when no hits", () => {
    expect(computeGlossaryCoverage([], "anything")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("returns full coverage when target term is present exactly", () => {
    const hit = makeHit("hello", "مرحبا", 0);
    expect(computeGlossaryCoverage([hit], "مرحبا")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("returns full coverage when translated has combining diacritics (Arabic fathatan)", () => {
    // Glossary stores "مرحبا" (plain), model outputs "مرحبًا" (with fathatan U+064B)
    const hit = makeHit("hello", "مرحبا", 0);
    expect(computeGlossaryCoverage([hit], "مرحبًا")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("returns full coverage when translated has combining diacritics (Latin accents)", () => {
    // Glossary stores "resume" (plain), model outputs "résumé" (with accents)
    const hit = makeHit("resume", "résumé", 0);
    expect(computeGlossaryCoverage([hit], "résumé")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("reports missing term when target is absent", () => {
    const hit = makeHit("hello", "مرحبا", 0);
    expect(computeGlossaryCoverage([hit], "شكرا")).toEqual({ glossaryCoverage: 0, missingTerms: ["hello"] });
  });

  test("computes partial coverage with multiple hits", () => {
    const hits = [makeHit("hello", "مرحبا", 0), makeHit("cloud", "سحابة", 6)];
    const result = computeGlossaryCoverage(hits, "مرحبًا والسحاب");
    // "مرحبا" matches via diacritic normalization, "سحابة" is absent
    expect(result.glossaryCoverage).toBeCloseTo(0.5);
    expect(result.missingTerms).toEqual(["cloud"]);
  });

  // Coverage is deliberately a substring check, not a whole-word one: model
  // output inflects target terms (Arabic ال, Russian case endings, Japanese
  // particles), and a boundary check would report those as missing.
  test("counts an Arabic target carrying the definite article as covered", () => {
    const hit = makeHit("book", "كتاب", 0);
    expect(computeGlossaryCoverage([hit], "قرأت الكتاب")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("counts an inflected Russian target as covered", () => {
    const hit = makeHit("computer", "компьютер", 0);
    expect(computeGlossaryCoverage([hit], "У меня нет компьютера")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("counts a CJK target embedded without spaces as covered", () => {
    const hits = [makeHit("machine learning", "机器学习", 0), makeHit("Tokyo Tower", "東京タワー", 20)];
    expect(computeGlossaryCoverage(hits, "我喜欢机器学习。東京タワーに行った")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("reports a missing CJK target", () => {
    const hit = makeHit("machine learning", "机器学习", 0);
    expect(computeGlossaryCoverage([hit], "我喜欢深度学习")).toEqual({ glossaryCoverage: 0, missingTerms: ["machine learning"] });
  });
});
