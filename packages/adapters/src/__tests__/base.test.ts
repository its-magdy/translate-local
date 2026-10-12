import { describe, test, expect } from "bun:test";
import { buildStructuredPrompt, buildNaturalPrompt } from "../base";
import type { GlossaryEntry, GlossaryHit, TranslationRequest } from "@translate-local/shared/types";

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

  test("places context snippets before the translate instruction, not in the text to translate", () => {
    const req = { ...baseRequest, contextSnippets: ["This is a software project."] };
    const { prompt } = buildStructuredPrompt(req);
    const [instructions, text] = prompt.split("Please translate the following");
    expect(instructions).toContain("This is a software project.");
    expect(text).not.toContain("This is a software project.");
  });

  test("delimits each context snippet and leaves a blank line before the translate instruction", () => {
    const req = { ...baseRequest, contextSnippets: ["First snippet.", "Second snippet."] };
    const { prompt } = buildStructuredPrompt(req);
    expect(prompt).toContain("<reference>\nFirst snippet.\n</reference>\n<reference>\nSecond snippet.\n</reference>\n\nPlease translate the following");
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

  test("renders the full prompt for a known source language", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt).toBe(
      "You are a professional English (en) to Arabic (ar) translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to Arabic grammar, vocabulary, and cultural sensitivities.\n" +
        "Produce only the Arabic translation, without any additional explanations or commentary.\n" +
        "Please translate the following English text into Arabic:\n\n\n" +
        "The API is ready.",
    );
  });

  test("auto source: uses source-agnostic phrasing instead of the literal \"auto\"", () => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, sourceLang: "auto" });
    expect(prompt).toBe(
      "You are a professional translator into Arabic (ar). Your goal is to accurately convey the meaning and nuances of the original text while adhering to Arabic grammar, vocabulary, and cultural sensitivities.\n" +
        "Produce only the Arabic translation, without any additional explanations or commentary.\n" +
        "Please translate the following text into Arabic:\n\n\n" +
        "The API is ready.",
    );
  });

  test("auto source in image mode: does not mention \"auto\"", () => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, sourceLang: "auto", imageBase64: "abc123" });
    expect(prompt).toBe("Extract all text from the image and translate it into Arabic (ar). Output only the translation.");
  });

  test("glossary reminder: rendered as target pairs before the translate instruction, source text untouched", () => {
    const req: TranslationRequest = {
      ...baseRequest,
      source: '<term translation="واجهة برمجة">API</term> is ready.',
      glossaryHits: [makeHit("API", "واجهة برمجة")],
      glossaryReminder: [{ source: "API", target: "واجهة برمجة" }],
    };
    const { prompt } = buildStructuredPrompt(req);
    const [instructions, text] = prompt.split("Please translate the following");
    expect(instructions).toContain('Your translation MUST contain these exact terms: "API" → "واجهة برمجة".');
    expect(text).toBe(' English text into Arabic:\n\n\n<term translation="واجهة برمجة">API</term> is ready.');
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

  test("auto source: does not mention \"auto\"", () => {
    const prompt = buildNaturalPrompt({ ...baseRequest, sourceLang: "auto" });
    expect(prompt).not.toContain("auto");
    expect(prompt).toContain("Translate the following text to ar.");
  });

  test("glossary reminder: listed before the text to translate", () => {
    const prompt = buildNaturalPrompt({ ...baseRequest, glossaryReminder: [{ source: "API", target: "واجهة برمجة" }] });
    const [instructions, text] = prompt.split("Text to translate:");
    expect(instructions).toContain('The translation must contain these exact terms:\n- "API" → "واجهة برمجة"');
    expect(text).toBe("\nThe API is ready.");
  });
});

describe("buildStructuredPrompt placeholder count", () => {
  const tag = (n: number) => `<term translation="__TLPH_${n}__">__TLPH_${n}__</term>`;
  const countText = (source: string) => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, source });
    return prompt.match(/exactly (\d+) placeholder occurrence\(s\)[^.]*\. Specifically: ([^.]*?)\. Your/);
  };

  test("one tagged sentinel counts once", () => {
    const m = countText(`Hello ${tag(0)}`);
    expect(m?.[1]).toBe("1");
    expect(m?.[2]).toBe("__TLPH_0__");
  });

  test("two tagged sentinels count 2", () => {
    const m = countText(`${tag(0)} and ${tag(1)}`);
    expect(m?.[1]).toBe("2");
    expect(m?.[2]).toBe("__TLPH_0__, __TLPH_1__");
  });

  test("three tagged sentinels count 3", () => {
    const m = countText(`${tag(0)} ${tag(1)} ${tag(2)}`);
    expect(m?.[1]).toBe("3");
    expect(m?.[2]).toBe("__TLPH_0__, __TLPH_1__, __TLPH_2__");
  });

  test("a repeated tagged sentinel counts each occurrence, lists it once", () => {
    const m = countText(`${tag(0)} then ${tag(0)}`);
    expect(m?.[1]).toBe("2");
    expect(m?.[2]).toBe("__TLPH_0__");
  });

  test("an untagged sentinel counts once", () => {
    const m = countText("Hello __TLPH_0__");
    expect(m?.[1]).toBe("1");
  });

  test("mix of tagged, untagged and real glossary tags", () => {
    const m = countText(`${tag(0)} __TLPH_1__ <term translation="واجهة">API</term>`);
    expect(m?.[1]).toBe("2");
    expect(m?.[2]).toBe("__TLPH_0__, __TLPH_1__");
  });
});

describe("placeholder rule wording", () => {
  const tag = (n: number) => `<term translation="__TLPH_${n}__">__TLPH_${n}__</term>`;
  const tokensIn = (text: string) => [...new Set(text.match(/__TLPH_\d+__/g) ?? [])].sort();
  const examplesOf = (prompt: string) =>
    prompt.split("EXAMPLES of correct placeholder preservation")[1].split("Please translate")[0];

  test("structured: examples reuse the source's own tokens and name no other", () => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, source: `${tag(3)} and ${tag(5)} and ${tag(9)}` });
    expect(tokensIn(examplesOf(prompt))).toEqual(["__TLPH_3__", "__TLPH_5__"]);
    expect(tokensIn(prompt)).toEqual(["__TLPH_3__", "__TLPH_5__", "__TLPH_9__"]);
  });

  test("structured: a one-token source gets a one-token example", () => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, source: `Hi ${tag(7)}` });
    expect(tokensIn(prompt)).toEqual(["__TLPH_7__"]);
    expect(tokensIn(examplesOf(prompt))).toEqual(["__TLPH_7__"]);
  });

  test("structured: asks for each token as many times as in the source, never 'exactly once'", () => {
    const { prompt } = buildStructuredPrompt({ ...baseRequest, source: `${tag(0)} then ${tag(0)}` });
    expect(prompt).toContain("exactly 2 placeholder occurrence(s)");
    expect(prompt).toContain("each as many times as it appears in the source");
    expect(prompt).not.toContain("exactly once");
  });

  test("structured: no rule without sentinels", () => {
    const { prompt } = buildStructuredPrompt(baseRequest);
    expect(prompt).not.toContain("PLACEHOLDER");
  });

  test("natural: names the count and the distinct tokens, once each", () => {
    const prompt = buildNaturalPrompt({ ...baseRequest, source: `${tag(0)} and ${tag(1)} and ${tag(0)}` });
    expect(prompt).toContain("contains 3 placeholder token(s) of the form __TLPH_N__: __TLPH_0__, __TLPH_1__.");
    expect(prompt).toContain("as many times as it appears in the text");
  });

  test("natural: rule comes before the text to translate", () => {
    const prompt = buildNaturalPrompt({ ...baseRequest, source: "Hello __TLPH_0__" });
    const [instructions, text] = prompt.split("Text to translate:");
    expect(instructions).toContain("contains 1 placeholder token(s)");
    expect(text).toBe("\nHello __TLPH_0__");
  });

  test("natural: no rule without sentinels or in image mode", () => {
    expect(buildNaturalPrompt(baseRequest)).not.toContain("placeholder");
    expect(buildNaturalPrompt({ ...baseRequest, source: "__TLPH_0__", imageBase64: "abc" })).not.toContain("placeholder token");
  });
});

describe("agreement repair prompt", () => {
  const repair: TranslationRequest = { source: "Erstellen Sie eine neue Zweig.", sourceLang: "en", targetLang: "de", repairTerms: ["Zweig"] };

  test("asks to proofread the target text around the terms, not to translate it", () => {
    const { prompt } = buildStructuredPrompt(repair);
    expect(prompt).toContain("German (de) proofreader");
    expect(prompt).toContain('"Zweig"');
    expect(prompt).not.toContain("English");
    expect(prompt).not.toContain("<term");
    expect(prompt.endsWith("Please correct the following German text:\n\n\nErstellen Sie eine neue Zweig.")).toBe(true);
    expect(buildNaturalPrompt(repair)).toBe(prompt);
  });

  test("ignores glossary hits, reminders and context", () => {
    const { prompt } = buildStructuredPrompt({
      ...repair,
      glossaryHits: [makeHit("branch", "Zweig")],
      glossaryReminder: [{ source: "branch", target: "Zweig" }],
      contextSnippets: ["SNIPPET"],
    });
    expect(prompt).toBe(buildStructuredPrompt(repair).prompt);
  });

  test("adds a placeholder rule only when the text has sentinels", () => {
    expect(buildStructuredPrompt(repair).prompt).not.toContain("placeholder");
    const { prompt } = buildStructuredPrompt({ ...repair, source: "Öffnen Sie __TLPH_0__ und __TLPH_1__ und __TLPH_0__." });
    expect(prompt).toContain("Copy the placeholder tokens (__TLPH_0__, __TLPH_1__) unchanged");
  });
});
