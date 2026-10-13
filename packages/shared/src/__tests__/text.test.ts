import { describe, test, expect } from "bun:test";
import { injectGlossaryTags, stripGlossaryTags, keptTermForm, normalizeWhitespace, computeGlossaryCoverage } from "../utils/text";
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

  test("code-switches the listed hits: target term inside, source word as an attribute", () => {
    const api = makeHit("API", "واجهة", 4);
    const cloud = makeHit("Cloud", "سحابة", 12);
    expect(injectGlossaryTags("The API and Cloud", [api, cloud], [api])).toBe(
      'The <term translation="واجهة" source="API">واجهة</term> and <term translation="سحابة">Cloud</term>',
    );
  });

  test("leaves out the source attribute when the source word and the term share a writing system", () => {
    const host = makeHit("server", "host", 12);
    expect(injectGlossaryTags("Restart the server.", [host], [host])).toBe('Restart the <term translation="host">host</term>.');
    const cyrillic = makeHit("commit", "коммит", 9);
    expect(injectGlossaryTags("Push the commit.", [cyrillic], [cyrillic])).toBe('Push the <term translation="коммит" source="commit">коммит</term>.');
    // Any shared script counts, so a mixed-script term gets no attribute.
    const mixed = makeHit("API", "واجهة API", 4);
    expect(injectGlossaryTags("The API", [mixed], [mixed])).toBe('The <term translation="واجهة API">واجهة API</term>');
  });

  test("leaves out the source attribute for a Han, kana or Hangul term", () => {
    for (const [word, term] of [["commit", "提交"], ["branch", "ブランチ"], ["cache", "キャッシュ"], ["server", "서버"], ["Arabic", "日本語API"]]) {
      const hit = makeHit(word, term, 4);
      expect(injectGlossaryTags(`Use ${word}`, [hit], [hit])).toBe(`Use <term translation="${term}">${term}</term>`);
    }
  });

  test("leaves out the source attribute for a Latin-script term", () => {
    for (const [word, term] of [["サーバー", "host"], ["الخادم", "host"], ["коммит", "commit"], ["サーバー", "hôte"]]) {
      const hit = makeHit(word, term, 4);
      expect(injectGlossaryTags(`Use ${word}`, [hit], [hit])).toBe(`Use <term translation="${term}">${term}</term>`);
    }
  });

  test("escapes the source attribute and the target term of a code-switched tag", () => {
    const hit = makeHit('A&"B', "س<ص", 4);
    expect(injectGlossaryTags('Use A&"B', [hit], [hit])).toBe('Use <term translation="س&lt;ص" source="A&amp;&quot;B">س&lt;ص</term>');
  });
});

describe("stripGlossaryTags", () => {
  test("replaces a complete term tag with its translation attribute", () => {
    const input = 'Use the <term translation="واجهة">API</term> here';
    expect(stripGlossaryTags(input)).toBe("Use the واجهة here");
  });

  test("keeps the required term when the model puts its own word inside the tag", () => {
    const input = 'Erstellen Sie eine neue <term translation="Zweig">Abteilung</term> für diese Funktion.';
    expect(stripGlossaryTags(input)).toBe("Erstellen Sie eine neue Zweig für diese Funktion.");
  });

  test("keeps the model's inflected form of the term written inside the tag", () => {
    // Arabic article, imperative, French plural (#116).
    expect(stripGlossaryTags('ادفع <term translation="كوميت">الكوميت</term> إلى الفرع')).toBe("ادفع الكوميت إلى الفرع");
    expect(stripGlossaryTags('ثم <term translation="نشر">انشر</term>.')).toBe("ثم انشر.");
    expect(stripGlossaryTags('Redémarrez les <term translation="hôte">hôtes</term>.')).toBe("Redémarrez les hôtes.");
    expect(stripGlossaryTags('<term translation="Zweig">Zweige</term> löschen')).toBe("Zweige löschen");
  });

  test("replaces an inner word that does not contain the term", () => {
    expect(stripGlossaryTags('ادفع <term translation="كوميت">الالتزام</term>')).toBe("ادفع كوميت");
    expect(stripGlossaryTags('<term translation="hôte">serveur</term>')).toBe("hôte");
  });

  test("replaces an inner text with more words than the term", () => {
    expect(stripGlossaryTags('<term translation="كوميت">هذا الكوميت</term>')).toBe("كوميت");
    expect(stripGlossaryTags('<term translation="طلب دمج">طلب دمج جديد</term>')).toBe("طلب دمج");
    // A multi-word term keeps an inner with as many words that contains it.
    expect(stripGlossaryTags('<term translation="طلب دمج">وطلب دمج</term>')).toBe("وطلب دمج");
  });

  test("drops quotes around a kept inner form", () => {
    expect(stripGlossaryTags('<term translation="كوميت">"الكوميت"</term>')).toBe("الكوميت");
    expect(stripGlossaryTags('les <term translation="hôte">« hôtes »</term>')).toBe("les hôtes");
  });

  test("writes the matched part of a kept form as the term (case-insensitive match)", () => {
    expect(stripGlossaryTags('<term translation="hôte">Hôtes</term> en ligne')).toBe("hôtes en ligne");
  });

  test("never keeps an inner form for sentinel tags", () => {
    expect(stripGlossaryTags('<term translation="__TLPH_0__">__TLPH_0__:</term>')).toBe("__TLPH_0__");
    expect(stripGlossaryTags('<term translation="__TLPH_1__">__TLPH_0__</term>')).toBe("__TLPH_1__");
  });

  test("still uses the attribute for an unclosed tag around an inflected form", () => {
    expect(stripGlossaryTags('ادفع <term translation="كوميت">الكوميت')).toBe("ادفع كوميت");
  });

  test("keeps inner content when the tag has no translation attribute", () => {
    expect(stripGlossaryTags("a <term>X</term> b")).toBe("a X b");
  });

  test("leaves sentinel tags (attribute equals content) unchanged in effect", () => {
    expect(stripGlossaryTags('<term translation="__TLPH_0__">__TLPH_0__</term> items')).toBe("__TLPH_0__ items");
  });

  test("unescapes entities written by injectGlossaryTags", () => {
    const entry = { targetTerm: 'say "hi" & <b>' } as never;
    const tagged = injectGlossaryTags("greet", [{ entry, startIndex: 0, endIndex: 5 } as never]);
    expect(tagged).toContain("&quot;");
    expect(stripGlossaryTags(tagged.replace(">greet<", ">wrong<"))).toBe('say "hi" & <b>');
    expect(stripGlossaryTags('<term translation="a &amp; b">x')).toBe("a & b");
  });

  test("handles text without tags", () => {
    expect(stripGlossaryTags("Hello world")).toBe("Hello world");
  });

  test("removes multiple tags", () => {
    const input = '<term translation="a">X</term> and <term translation="b">Y</term>';
    expect(stripGlossaryTags(input)).toBe("a and b");
  });

  test("strips tags when inner content spans a newline", () => {
    const input = '<term translation="a">line one\nline two</term>';
    expect(stripGlossaryTags(input)).toBe("a");
    expect(stripGlossaryTags("<term>line one\nline two</term>")).toBe("line one\nline two");
  });

  test("uses translation attribute for unclosed tags", () => {
    const input = 'prefix <term translation="مرحبا">hello';
    expect(stripGlossaryTags(input)).toBe("prefix مرحبا");
  });

  test("uses the translation attribute for a code-switched tag, closed or not", () => {
    expect(stripGlossaryTags('مسح <term translation="الكاش" source="cache">الكاش</term>.')).toBe("مسح الكاش.");
    expect(stripGlossaryTags('مسح <term translation="الكاش" source="cache">ذاكرة')).toBe("مسح الكاش");
  });

  test("handles multiple unclosed tags", () => {
    // Space after "machine learning" is consumed as part of the source content — normalizeWhitespace handles the rest
    const input = '<term translation="تعلم الآلة">machine learning<term translation="شبكة عصبية">neural network';
    expect(stripGlossaryTags(input)).toBe("تعلم الآلةشبكة عصبية");
  });

  test("matches the original regex implementation on random tag soup", () => {
    const regexStrip = (text: string) =>
      text
        .replace(/<(term[^>]*)>(.*?)<\/term>/gs, (_m, open: string, inner: string) => {
          const attr = /\btranslation="([^"]*)"/.exec(open)?.[1];
          return attr === undefined ? inner : (keptTermForm(inner, attr) ?? attr);
        })
        .replace(/<term\s+translation="([^"]*)">[^<]*/g, "$1")
        .replace(/<term[^>]*>/g, "");
    const pieces = ['<term translation="t">', "<term", "<term ", ">", "</term>", "</term", '"', "a", "T", " ", "\n", "<b>"];
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
    stripGlossaryTags('<term translation=""'.repeat(100_000));
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
