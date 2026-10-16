import { describe, test, expect } from "bun:test";
import { injectGlossaryTags, stripGlossaryTags, keptTermForm, capitalizeTerm, normalizeWhitespace, computeGlossaryCoverage, foundForm, tagCheckCandidates, checkKeepsWord } from "../utils/text";
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

  test("keeps a kept form's matched part capitalized when the model capitalized the term", () => {
    expect(stripGlossaryTags('<term translation="hôte">Hôtes</term> en ligne')).toBe("Hôtes en ligne");
    expect(stripGlossaryTags('<term translation="bereitstellen">Bereitstellen</term>')).toBe("Bereitstellen");
    expect(stripGlossaryTags('vor dem <term translation="bereitstellen">Bereitstellen</term>')).toBe("vor dem Bereitstellen");
  });

  test("writes any other case variant of a kept form's matched part as the term", () => {
    expect(stripGlossaryTags('Le <term translation="hôte">HÔTE</term> en ligne')).toBe("Le hôte en ligne");
    expect(stripGlossaryTags('<term translation="API">api</term> key')).toBe("API key");
    expect(stripGlossaryTags('<term translation="API">Api</term> key')).toBe("API key");
    expect(stripGlossaryTags('<term translation="iOS">IOS</term> app')).toBe("iOS app");
    expect(stripGlossaryTags('<term translation="iOS">Système</term> mis à jour')).toBe("iOS mis à jour");
  });

  test("lowercases the letters glued after an all-caps match written as the term", () => {
    expect(stripGlossaryTags('Les <term translation="hôte">HÔTES</term> sont prêts')).toBe("Les hôtes sont prêts");
    expect(stripGlossaryTags('<term translation="Zweig">ZWEIGE</term>')).toBe("Zweige");
    // Text before the match, or after a non-letter, stays as written.
    expect(stripGlossaryTags("<term translation=\"hôte\">L'HÔTE</term> est prêt")).toBe("L'hôte est prêt");
    expect(stripGlossaryTags('Voir <term translation="Zweig">GIT-ZWEIGE</term>')).toBe("Voir GIT-Zweige");
    expect(stripGlossaryTags('Les <term translation="hôte">API-HÔTES</term>')).toBe("Les API-hôtes");
    expect(stripGlossaryTags('<term translation="iOS">IOS-APPS</term>')).toBe("iOS-APPS");
    expect(stripGlossaryTags('Les <term translation="hôte">__TLPH_0__HÔTES</term>')).toBe("Les __TLPH_0__hôtes");
    // Lowercased with the match for context: Greek final sigma.
    expect(stripGlossaryTags('Ο <term translation="χρήστη">ΧΡΉΣΤΗΣ</term> συνδέθηκε')).toBe("Ο χρήστης συνδέθηκε");
    // Capital sharp s folds to ß, so the span and the rest are sliced from the model's word.
    expect(stripGlossaryTags('<term translation="Straße">STRAẞEN</term>')).toBe("Straßen");
    // SS does not fold to ß: no match, so the term replaces the word.
    expect(stripGlossaryTags('<term translation="Straße">STRASSEN</term>')).toBe("Straße");
    // Kept as written: the term itself, or capitalized, matched exactly.
    expect(stripGlossaryTags('<term translation="API">APIS</term>')).toBe("APIS");
    expect(stripGlossaryTags('<term translation="x">XS</term>')).toBe("XS");
    // A word with a lowercase letter keeps the rest as written.
    expect(stripGlossaryTags('<term translation="Zweig">ZWEIGe</term>')).toBe("Zweige");
    expect(stripGlossaryTags('<term translation="الكاش">والكاش</term>')).toBe("والكاش");
  });

  test("capitalizes the term of an all-caps match that starts a sentence", () => {
    expect(stripGlossaryTags('<term translation="hôte">HÔTES</term> sont prêts')).toBe("Hôtes sont prêts");
    expect(stripGlossaryTags('<term translation="hôte">HÔTE</term> en ligne')).toBe("Hôte en ligne");
    expect(stripGlossaryTags('Prêt. <term translation="hôte">« HÔTES »</term> actifs')).toBe("Prêt. Hôtes actifs");
    expect(stripGlossaryTags('Titre\n<term translation="hôte">HÔTES</term>')).toBe("Titre\nHôtes");
    expect(stripGlossaryTags('<term translation="iOS">IOS</term> prêt')).toBe("iOS prêt");
    // Not mid-sentence, nor when the match does not start the word.
    expect(stripGlossaryTags('Les <term translation="hôte">HÔTES</term>')).toBe("Les hôtes");
    expect(stripGlossaryTags("<term translation=\"hôte\">L'HÔTES</term>")).toBe("L'hôtes");
  });

  test("capitalizes a replacing term when the model's word is capitalized at a sentence start", () => {
    expect(stripGlossaryTags('<term translation="hôte">Serveur</term> : détails')).toBe("Hôte : détails");
    expect(stripGlossaryTags('  <term translation="hôte">« Serveur »</term> prêt')).toBe("  Hôte prêt");
    expect(stripGlossaryTags('Prêt. <term translation="hôte">Serveur</term> actif')).toBe("Prêt. Hôte actif");
    expect(stripGlossaryTags('Titre\n<term translation="hôte">Serveur</term>')).toBe("Titre\nHôte");
    // Sentence end inside an earlier tag, whitespace in between.
    expect(stripGlossaryTags('<term>Fin.</term> <term translation="hôte">Serveur</term>')).toBe("Fin. Hôte");
  });

  test("does not capitalize a replacing term mid-sentence or for a lowercase word", () => {
    expect(stripGlossaryTags('Le <term translation="hôte">Serveur</term> est prêt')).toBe("Le hôte est prêt");
    expect(stripGlossaryTags('v1.<term translation="hôte">Serveur</term>')).toBe("v1.hôte");
    expect(stripGlossaryTags('Prêt: <term translation="hôte">Serveur</term>')).toBe("Prêt: hôte");
    expect(stripGlossaryTags('<term translation="hôte">serveur</term> prêt')).toBe("hôte prêt");
    expect(stripGlossaryTags('<term translation="__TLPH_0__">Serveur</term>')).toBe("__TLPH_0__");
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
    const input = '<term translation="a">x</term> and <term translation="b">Y</term>';
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
    // The capitalization check looks at the output written so far, so build it match by match.
    const replaceTags = (text: string) => {
      let out = "";
      let last = 0;
      for (const m of text.matchAll(/<(term[^>]*)>(.*?)<\/term>/gs)) {
        out += text.slice(last, m.index);
        const [, open, inner] = m;
        const attr = /\btranslation="([^"]*)"/.exec(open)?.[1];
        const atStart = /(?:^\s*|\n\s*|[.!?…]\s+)$/u.test(out);
        const capitalize = atStart && /^\P{L}*\p{Lu}/u.test(inner);
        out += attr === undefined ? inner : (keptTermForm(inner, attr, [], atStart) ?? (capitalize ? capitalizeTerm(attr) : attr));
        last = m.index + m[0].length;
      }
      return out + text.slice(last);
    };
    const regexStrip = (text: string) =>
      replaceTags(text)
        .replace(/<term\s+translation="([^"]*)">[^<]*/g, "$1")
        .replace(/<term[^>]*>/g, "");
    const pieces = ['<term translation="t">', "<term", "<term ", ">", "</term>", "</term", '"', "a", "T", "S", ". ", " ", "\n", "<b>"];
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

describe("capitalizeTerm", () => {
  test("raises the first letter of an all-lowercase term only", () => {
    expect(capitalizeTerm("hôte")).toBe("Hôte");
    expect(capitalizeTerm("élément clé")).toBe("Élément clé");
    expect(capitalizeTerm("Zweig")).toBe("Zweig");
    expect(capitalizeTerm("iOS")).toBe("iOS");
    expect(capitalizeTerm("eBay")).toBe("eBay");
    expect(capitalizeTerm("الكاش")).toBe("الكاش");
    expect(capitalizeTerm("__TLPH_0__")).toBe("__TLPH_0__");
    expect(capitalizeTerm("")).toBe("");
  });
});

describe("glossary term forms", () => {
  const FORMS = ["Bereitstellung", "bereitgestellt", "stellen … bereit"];
  const deploy = (start = 0): GlossaryHit => {
    const hit = makeHit("deploy", "bereitstellen", start);
    return { ...hit, entry: { ...hit.entry, forms: FORMS } };
  };

  test("counts any form, or the term capitalized, as covered", () => {
    expect(computeGlossaryCoverage([deploy()], "vor der erneuten Bereitstellung")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
    expect(computeGlossaryCoverage([deploy()], "Die App wurde bereitgestellt.")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
    expect(computeGlossaryCoverage([deploy()], "Bereitstellen")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
    expect(computeGlossaryCoverage([deploy()], "Einsatz jetzt")).toEqual({ glossaryCoverage: 0, missingTerms: ["deploy"] });
    // Without forms, only the term counts.
    expect(computeGlossaryCoverage([makeHit("deploy", "bereitstellen", 0)], "Bereitstellung")).toEqual({ glossaryCoverage: 0, missingTerms: ["deploy"] });
  });

  test("a split form needs its parts as whole words, in order, in one sentence", () => {
    expect(foundForm("Stellen Sie den Zweig jetzt bereit.", "bereitstellen", FORMS)).toBe("stellen … bereit");
    expect(foundForm("Bitte stellen Sie ihn bereit", "bereitstellen", ["stellen ... bereit"])).toBe("stellen ... bereit");
    expect(foundForm("Bereit? Stellen Sie ihn ab.", "bereitstellen", FORMS)).toBeUndefined();
    expect(foundForm("Stellen Sie ihn ab. Wir sind bereit.", "bereitstellen", FORMS)).toBeUndefined();
    expect(foundForm("Einstellen und vorbereiten", "bereitstellen", FORMS)).toBeUndefined();
    expect(foundForm("Stellen Sie ihn\nbereit", "bereitstellen", FORMS)).toBeUndefined();
    // Abbreviations and an eliding … don't end the sentence.
    expect(foundForm("Bitte stellen Sie z. B. den Zweig bereit.", "bereitstellen", FORMS)).toBe("stellen … bereit");
    expect(foundForm("Stellen Sie… den Zweig bereit", "bereitstellen", FORMS)).toBe("stellen … bereit");
    expect(foundForm("x 𝐀𝐁𝐂", "y", ["x … 𝐀𝐁"])).toBeUndefined();
  });

  test("matches forms in linear time on long runs of spaces", () => {
    const spaces = " ".repeat(20_000);
    const start = performance.now();
    foundForm(`a${spaces}b`, "x", [`stellen${spaces}bereit`, `stellen …${spaces}bereit`]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("never splits the target term itself, even with an ellipsis", () => {
    expect(computeGlossaryCoverage([makeHit("save as", "Speichern unter…", 0)], "Klicken Sie auf Speichern unter")).toEqual({ glossaryCoverage: 0, missingTerms: ["save as"] });
    expect(computeGlossaryCoverage([makeHit("back", "Weiter … Zurück", 0)], "Weiter … Zurück")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("lends one entry's forms to another entry with the same target term", () => {
    const withForm = deploy();
    const other = makeHit("ship", "bereitstellen", 10);
    expect(computeGlossaryCoverage([withForm, other], "Bereitstellung")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("keeps a form written inside the term tag", () => {
    expect(keptTermForm("Bereitstellung", "bereitstellen", FORMS)).toBe("Bereitstellung");
    expect(keptTermForm("Bereitstellungen", "bereitstellen", FORMS)).toBe("Bereitstellungen");
    expect(keptTermForm("Bereitstellung", "bereitstellen")).toBeUndefined();
    // A split form never stands in a tag; a form with more words than the inner is skipped.
    expect(keptTermForm("stellen", "bereitstellen", FORMS)).toBeUndefined();
    const forms = new Map([["bereitstellen", FORMS]]);
    expect(stripGlossaryTags('vor der erneuten <term translation="bereitstellen">Bereitstellung</term>', forms)).toBe("vor der erneuten Bereitstellung");
    expect(stripGlossaryTags('vor der erneuten <term translation="bereitstellen">Bereitstellung</term>')).toBe("vor der erneuten bereitstellen");
    expect(stripGlossaryTags('<term translation="bereitstellen">Einsatz</term> jetzt', forms)).toBe("Bereitstellen jetzt");
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

  test("counts the term with its first letter capitalized as present", () => {
    expect(computeGlossaryCoverage([makeHit("deploy", "bereitstellen", 0)], "Bereitstellen")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
    expect(computeGlossaryCoverage([makeHit("server", "hôte", 0)], "Hôte : détails")).toEqual({ glossaryCoverage: 1, missingTerms: [] });
  });

  test("still reports other case variants of the term as missing", () => {
    expect(computeGlossaryCoverage([makeHit("server", "hôte", 0)], "HÔTE")).toEqual({ glossaryCoverage: 0, missingTerms: ["server"] });
    expect(computeGlossaryCoverage([makeHit("key", "API", 0)], "Api")).toEqual({ glossaryCoverage: 0, missingTerms: ["key"] });
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

describe("tag check", () => {
  const deploy = makeHit("deploy", "bereitstellen", 0);
  const deployForms = new Map([["bereitstellen", ["Bereitstellung", "stellen … bereit"]]]);
  const auto = '<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.';

  test("finds a tag around another word while the term is outside the tags", () => {
    expect(tagCheckCandidates(auto, [deploy])).toEqual(new Map([["bereitstellen", "Automatisch"]]));
    const mirror = 'Copier le <term translation="dépôt">répertoire</term> vers un autre dépôt distant.';
    expect(tagCheckCandidates(mirror, [makeHit("repository", "dépôt", 0)])).toEqual(new Map([["dépôt", "répertoire"]]));
    // No term outside the tags, or a kept form inside: nothing to check.
    expect(tagCheckCandidates('<term translation="bereitstellen">Automatisch</term> nach jedem Commit.', [deploy]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="bereitstellen">Bereitstellen</term> nach bereitstellen.', [deploy]).size).toBe(0);
    expect(tagCheckCandidates(auto, []).size).toBe(0);
  });

  test("needs exactly one hit and one tag for the term", () => {
    expect(tagCheckCandidates(auto, [deploy, makeHit("deploy", "bereitstellen", 30)]).size).toBe(0);
    // Two source terms with one target term count as two hits.
    expect(tagCheckCandidates(auto, [deploy, makeHit("ship", "bereitstellen", 30)]).size).toBe(0);
    const twoTags = '<term translation="bereitstellen">Automatisch</term> <term translation="bereitstellen">nach</term> bereitstellen.';
    expect(tagCheckCandidates(twoTags, [deploy]).size).toBe(0);
    // An unclosed second tag for the term counts as a tag too.
    expect(tagCheckCandidates(`${auto} <term translation="bereitstellen">x`, [deploy]).size).toBe(0);
    // Another term's hits don't matter.
    expect(tagCheckCandidates(auto, [deploy, makeHit("branch", "Zweig", 20)])).toEqual(new Map([["bereitstellen", "Automatisch"]]));
  });

  test("counts the term's forms outside the tags, one-piece and split", () => {
    const noun = '<term translation="bereitstellen">Automatisch</term> nach jeder Bereitstellung.';
    expect(tagCheckCandidates(noun, [deploy], deployForms)).toEqual(new Map([["bereitstellen", "Automatisch"]]));
    expect(tagCheckCandidates(noun, [deploy]).size).toBe(0);
    const split = 'Bitte <term translation="bereitstellen">automatisch</term> stellen Sie den Zweig bereit.';
    expect(tagCheckCandidates(split, [deploy], deployForms)).toEqual(new Map([["bereitstellen", "automatisch"]]));
    // A split form's parts around the tag count: the tag may hold the word between them.
    expect(tagCheckCandidates('Stellen <term translation="bereitstellen">Sie</term> bereit.', [deploy], deployForms).size).toBe(1);
    // A part inside the tag doesn't.
    expect(tagCheckCandidates('<term translation="bereitstellen">Stellen Sie</term> bereit.', [deploy], deployForms).size).toBe(0);
  });

  test("never for sentinels, leaked source words or non-words", () => {
    const sentinel = makeHit("__TLPH_0__", "__TLPH_0__", 0);
    expect(tagCheckCandidates('<term translation="__TLPH_0__">x</term> __TLPH_0__', [sentinel]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="bereitstellen">Deploy</term> und bereitstellen', [deploy]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="bereitstellen">« deploy »</term> und bereitstellen', [deploy]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="bereitstellen">…</term> bereitstellen', [deploy]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="bereitstellen"><b>x</term> bereitstellen', [deploy]).size).toBe(0);
  });

  test("needs the term outside the tags as a whole word, and never fires for no-space scripts", () => {
    // No word edges to check in CJK: the term may be part of another word (キーボード), the word too (鍵盤).
    const key = makeHit("key", "キー", 0);
    expect(tagCheckCandidates('<term translation="キー">鍵</term>を押してキーボード', [key]).size).toBe(0);
    expect(tagCheckCandidates('<term translation="キー">鍵</term>を押してキー', [key]).size).toBe(0);
    // A Latin-script term with a CJK word in the tag.
    expect(tagCheckCandidates('<term translation="API">接口</term>を使う API', [makeHit("api", "API", 0)]).size).toBe(0);
    const host = makeHit("server", "hôte", 0);
    expect(tagCheckCandidates('Le <term translation="hôte">serveur</term> de l\'hôtel', [host]).size).toBe(0);
    expect(tagCheckCandidates('Le <term translation="hôte">serveur</term> et l\'hôte', [host])).toEqual(new Map([["hôte", "serveur"]]));
    expect(tagCheckCandidates('Le <term translation="hôte">serveur</term> et l\'Hôte', [host]).size).toBe(1);
    // Forms count as whole words too.
    expect(tagCheckCandidates('<term translation="bereitstellen">Automatisch</term> nach jeder Bereitstellungsrunde.', [deploy], deployForms).size).toBe(0);
  });

  test("two terms can both be candidates", () => {
    const raw = '<term translation="hôte">serveur</term> hôte, <term translation="jeton">clé</term> jeton';
    expect(tagCheckCandidates(raw, [makeHit("server", "hôte", 0), makeHit("token", "jeton", 10)])).toEqual(new Map([["hôte", "serveur"], ["jeton", "clé"]]));
  });

  test("an unclosed tag and the text after it are not outside", () => {
    expect(tagCheckCandidates('<term translation="bereitstellen">Automatisch</term> <term translation="Zweig">nach bereitstellen', [deploy, makeHit("branch", "Zweig", 20)]).size).toBe(0);
    // A leftover opening tag without a translation attribute is dropped, its text kept.
    expect(tagCheckCandidates('<term translation="bereitstellen">Automatisch</term> <term>bereitstellen', [deploy]).size).toBe(1);
  });

  test("the strip keeps a checked word, only for its term and exact inner", () => {
    const kept = new Map([["bereitstellen", "Automatisch"]]);
    expect(stripGlossaryTags(auto, undefined, kept)).toBe("Automatisch nach jedem Commit bereitstellen.");
    expect(stripGlossaryTags(auto)).toBe("Bereitstellen nach jedem Commit bereitstellen.");
    expect(stripGlossaryTags('<term translation="Zweig">Automatisch</term>', undefined, kept)).toBe("Zweig");
    expect(stripGlossaryTags('<term translation="bereitstellen">Manuell</term>', undefined, kept)).toBe("Bereitstellen");
  });

  test("keeps the word only when the check has the term and the word", () => {
    expect(checkKeepsWord("Automatisch nach jedem Commit bereitstellen.", "bereitstellen", "Automatisch")).toBe(true);
    expect(checkKeepsWord("Nach jedem Commit automatisch bereitstellen.", "bereitstellen", "Automatisch")).toBe(true);
    // The word only as part of another word, or the term missing.
    expect(checkKeepsWord("Automatischer Commit, dann bereitstellen.", "bereitstellen", "Automatisch")).toBe(false);
    expect(checkKeepsWord("Automatisch nach jedem Commit.", "bereitstellen", "Automatisch")).toBe(false);
    expect(checkKeepsWord("Automatisch nach jeder Bereitstellung.", "bereitstellen", "Automatisch", deployForms)).toBe(true);
    // The counter-example: the check translates the source word as the term.
    expect(checkKeepsWord("Répliquer le dépôt vers un deuxième serveur distant.", "dépôt", "répertoire")).toBe(false);
    // A tag around the word in the check is the term's place: the strip puts the term there.
    expect(checkKeepsWord('Copier le <term translation="dépôt">répertoire</term> vers un dépôt.', "dépôt", "répertoire")).toBe(false);
    // Marks dropped, quotes and apostrophes handled.
    expect(checkKeepsWord("Envoyez la validation vers la branche d'origine.", "branche", "d'origine")).toBe(true);
    expect(checkKeepsWord("Envoyez la validation vers la branche d'origine.", "branche", "« origine »")).toBe(true);
    expect(checkKeepsWord("Deploiement automatique, puis depot.", "dépôt", "Déploiement")).toBe(true);
  });

  test("a word inside a multi-word term or form in the check does not count", () => {
    expect(checkKeepsWord("Öffnen Sie einen Pull Request.", "Pull Request", "Request")).toBe(false);
    expect(checkKeepsWord("Öffnen Sie einen Pull Request.", "Pull Request", "Pull")).toBe(false);
    expect(checkKeepsWord("Öffnen Sie einen PULL REQUEST.", "Pull Request", "pull")).toBe(false);
    expect(checkKeepsWord("Pull Request: Request prüfen.", "Pull Request", "Request")).toBe(true);
    const forms = new Map([["Merge-Anfrage", ["Zusammenführungs Anfrage"]]]);
    expect(checkKeepsWord("Eine Zusammenführungs Anfrage öffnen.", "Merge-Anfrage", "Anfrage", forms)).toBe(false);
  });

  test("runs in linear time on many tags", () => {
    const start = performance.now();
    const tags = Array.from({ length: 50_000 }, (_, i) => `<term translation="w${i}q">x</term> filler text`).join(" ");
    tagCheckCandidates(tags, [makeHit("a", "filler", 0), makeHit("b", "w7q", 0)]);
    tagCheckCandidates("<term".repeat(100_000), [deploy]);
    tagCheckCandidates('<term translation="bereitstellen">'.repeat(50_000), [deploy]);
    tagCheckCandidates('<term translation="bereitstellen">a</term>'.repeat(50_000) + " bereitstellen", [deploy]);
    checkKeepsWord("a ".repeat(100_000) + "bereitstellen", "bereitstellen", "a b");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
