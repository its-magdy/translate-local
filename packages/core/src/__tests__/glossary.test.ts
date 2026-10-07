import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GlossaryStore, matchTerms } from "../glossary";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GlossaryEntry } from "@translate-local/shared/types";

describe("matchTerms", () => {
  const entry = (sourceTerm: string, targetTerm: string): GlossaryEntry => ({
    id: "1",
    sourceTerm,
    targetTerm,
    sourceLang: "en",
    targetLang: "ar",
  });

  it("terminates and matches nothing for an empty term (zero-width regex hang)", () => {
    const hits = matchTerms("hello, world 123", [entry("", "x")]);
    expect(hits).toHaveLength(0);
  });

  it("terminates for a whitespace-only term", () => {
    const hits = matchTerms("hello, world", [entry("   ", "x")]);
    expect(hits).toHaveLength(0);
  });

  it("finds a simple term", () => {
    const hits = matchTerms("The API is fast", [entry("API", "واجهة برمجة")]);
    expect(hits).toHaveLength(1);
    expect(hits[0].startIndex).toBe(4);
    expect(hits[0].endIndex).toBe(7);
    expect(hits[0].entry.targetTerm).toBe("واجهة برمجة");
  });

  it("is case-insensitive", () => {
    const hits = matchTerms("The api is fast", [entry("API", "واجهة برمجة")]);
    expect(hits).toHaveLength(1);
  });

  it("uses word boundaries (no partial matches)", () => {
    const text = "APIs are not the same as API";
    const hits = matchTerms(text, [entry("API", "واجهة برمجة")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("API");
    expect(hits[0].startIndex).toBe(text.lastIndexOf("API"));
  });

  it("prefers longest match (no overlap)", () => {
    const entries = [entry("machine learning", "تعلم الآلة"), entry("machine", "آلة")];
    const hits = matchTerms("machine learning is great", entries);
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.sourceTerm).toBe("machine learning");
  });

  it("returns multiple non-overlapping hits sorted by startIndex", () => {
    const entries = [entry("API", "واجهة برمجة"), entry("model", "نموذج")];
    const hits = matchTerms("The API and model are ready", entries);
    expect(hits).toHaveLength(2);
    expect(hits[0].startIndex).toBeLessThan(hits[1].startIndex);
  });

  it("returns empty array for no matches", () => {
    const hits = matchTerms("Hello world", [entry("API", "واجهة برمجة")]);
    expect(hits).toHaveLength(0);
  });

  it("handles overlapping terms: 'API' and 'API key'", () => {
    const entries = [entry("API", "واجهة برمجة"), entry("API key", "مفتاح واجهة برمجة")];
    const hits = matchTerms("Use the API key to call the API", entries);
    expect(hits).toHaveLength(2);
    // "API key" should match as the longer term first
    expect(hits[0].entry.sourceTerm).toBe("API key");
    // Standalone "API" at the end
    expect(hits[1].entry.sourceTerm).toBe("API");
  });

  it("handles overlapping terms where shorter is substring of longer", () => {
    const entries = [entry("cloud", "سحابة"), entry("cloud computing", "الحوسبة السحابية")];
    const hits = matchTerms("cloud computing and cloud storage", entries);
    expect(hits).toHaveLength(2);
    expect(hits[0].entry.sourceTerm).toBe("cloud computing");
    expect(hits[1].entry.sourceTerm).toBe("cloud");
  });

  it("matches Arabic source terms", () => {
    const hits = matchTerms("أنا أحب الذكاء الاصطناعي كثيرا", [entry("الذكاء الاصطناعي", "artificial intelligence")]);
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.sourceTerm).toBe("الذكاء الاصطناعي");
  });

  it("does not match Arabic term as substring of longer word", () => {
    // "كتاب" should not match inside "كتابة"
    const hits = matchTerms("كتابة جميلة", [entry("كتاب", "book")]);
    expect(hits).toHaveLength(0);
  });

  it("matches CJK source terms when exact string", () => {
    const hits = matchTerms("机器学习", [entry("机器学习", "machine learning")]);
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.sourceTerm).toBe("机器学习");
  });

  it("matches CJK source terms delimited by punctuation", () => {
    const hits = matchTerms("我喜欢「机器学习」技术", [entry("机器学习", "machine learning")]);
    expect(hits).toHaveLength(1);
  });

  it("matches CJK source terms delimited by comma", () => {
    const hits = matchTerms("机器学习，很好", [entry("机器学习", "machine learning")]);
    expect(hits).toHaveLength(1);
  });

  it("matches CJK term embedded in running text (no word spaces)", () => {
    const text = "我喜欢机器学习技术";
    const hits = matchTerms(text, [entry("机器学习", "machine learning")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("机器学习");
  });

  it("matches Japanese kana/kanji term followed by a particle", () => {
    const text = "東京タワーに行きました";
    const hits = matchTerms(text, [entry("東京タワー", "Tokyo Tower")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("東京タワー");
  });

  it("matches a katakana term inside a sentence", () => {
    const hits = matchTerms("新しいコンピューターを買った", [entry("コンピューター", "computer")]);
    expect(hits).toHaveLength(1);
  });

  it("matches a Thai term without word spaces", () => {
    const hits = matchTerms("ฉันชอบปัญญาประดิษฐ์มาก", [entry("ปัญญาประดิษฐ์", "artificial intelligence")]);
    expect(hits).toHaveLength(1);
  });

  it("matches a Latin term written directly against Japanese text", () => {
    const text = "このAPIキーを使う";
    const hits = matchTerms(text, [entry("API", "API")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("API");
  });

  it("does not match an accented-Latin prefix of a longer word", () => {
    // \b is ASCII-only: \bcaf\b used to match inside "café"
    expect(matchTerms("un café noir", [entry("caf", "x")])).toHaveLength(0);
  });

  it("matches accented Latin terms as whole words", () => {
    const text = "Un café, s'il vous plaît";
    const hits = matchTerms(text, [entry("café", "coffee")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("café");
    expect(matchTerms("cafés", [entry("café", "coffee")])).toHaveLength(0);
  });

  it("does not split a word on a combining mark", () => {
    // "cafe" + U+0301 (decomposed é): "cafe" must not match the first four code units
    expect(matchTerms("cafe\u0301 noir", [entry("cafe", "x")])).toHaveLength(0);
  });

  it("matches Russian (Cyrillic) terms as whole words", () => {
    const text = "Этот компьютер быстрый";
    const hits = matchTerms(text, [entry("компьютер", "computer")]);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe("компьютер");
    expect(matchTerms("компьютеры", [entry("компьютер", "computer")])).toHaveLength(0);
  });

  it("is case-insensitive for Cyrillic", () => {
    expect(matchTerms("Компьютер работает", [entry("компьютер", "computer")])).toHaveLength(1);
  });

  it("does not match an Arabic term behind an attached prefix (whole-word only)", () => {
    // Documented decision: ال / و / ب clitics are not stripped; add الكتاب as its own entry.
    expect(matchTerms("قرأت الكتاب", [entry("كتاب", "book")])).toHaveLength(0);
    expect(matchTerms("قرأت كتاب جميل", [entry("كتاب", "book")])).toHaveLength(1);
  });

  it("treats a trailing harakat mark as part of the word", () => {
    // Combining marks (\p{M}) never form a boundary, so the hit can't end mid-grapheme
    expect(matchTerms("هذا كتابٌ", [entry("كتاب", "book")])).toHaveLength(0);
  });

  it("escapes regex metacharacters in terms", () => {
    const entries = [entry("C++", "x"), entry("Node.js", "y"), entry("(beta)", "z"), entry("a|b", "w")];
    const text = "C++ and Node.js (beta) a|b";
    const hits = matchTerms(text, entries);
    expect(hits.map((h) => text.slice(h.startIndex, h.endIndex))).toEqual(["C++", "Node.js", "(beta)", "a|b"]);
    expect(matchTerms("NodeXjs", [entry("Node.js", "y")])).toHaveLength(0);
    expect(matchTerms("ab", [entry("a|b", "w")])).toHaveLength(0);
  });
});

describe("GlossaryStore", () => {
  let dbPath: string;
  let store: GlossaryStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `tl-glossary-${Date.now()}.db`);
    store = new GlossaryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
  });

  it("adds and lists entries", () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const entries = store.list("en", "ar");
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceTerm).toBe("API");
    expect(entries[0].targetTerm).toBe("واجهة برمجة");
  });

  it("rejects empty or whitespace-only terms", () => {
    expect(() => store.add({ sourceTerm: "", targetTerm: "x", sourceLang: "en", targetLang: "ar" })).toThrow(/non-empty/);
    expect(() => store.add({ sourceTerm: "x", targetTerm: "  ", sourceLang: "en", targetLang: "ar" })).toThrow(/non-empty/);
    expect(store.list()).toHaveLength(0);
  });

  it("removes entry by id", () => {
    const entry = store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    expect(store.remove(entry.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("returns false when removing nonexistent id", () => {
    expect(store.remove("nonexistent-id")).toBe(false);
  });

  it("filters list by sourceLang and targetLang", () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    store.add({ sourceTerm: "model", targetTerm: "modèle", sourceLang: "en", targetLang: "fr" });
    expect(store.list("en", "ar")).toHaveLength(1);
    expect(store.list("en", "fr")).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
  });

  it("lookup falls back from a regional tag to the base language", () => {
    store.add({ sourceTerm: "API", targetTerm: "interface", sourceLang: "en", targetLang: "fr" });
    expect(store.lookup("en-US", "fr")).toHaveLength(1);
    expect(store.lookup("en", "fr-CA")).toHaveLength(1);
    expect(store.lookup("en-GB", "fr-FR")).toHaveLength(1);
  });

  it("lookup does not widen a base query to regional entries", () => {
    store.add({ sourceTerm: "API", targetTerm: "interface", sourceLang: "en-US", targetLang: "fr" });
    expect(store.lookup("en", "fr")).toHaveLength(0);
    expect(store.lookup("en-GB", "fr")).toHaveLength(0);
    expect(store.lookup("en-US", "fr")).toHaveLength(1);
  });

  it("lookup is case-insensitive on language tags", () => {
    store.add({ sourceTerm: "API", targetTerm: "interface", sourceLang: "en-US", targetLang: "FR" });
    expect(store.lookup("en-us", "fr")).toHaveLength(1);
    expect(store.lookup("EN-US", "fr-ca")).toHaveLength(1);
  });

  it("lookup walks multi-subtag tags down to the base (zh-Hant-TW → zh-Hant → zh)", () => {
    store.add({ sourceTerm: "model", targetTerm: "模型", sourceLang: "en", targetLang: "zh" });
    store.add({ sourceTerm: "software", targetTerm: "軟體", sourceLang: "en", targetLang: "zh-Hant" });
    const terms = store.lookup("en", "zh-Hant-TW").map((e) => e.targetTerm).sort();
    expect(terms).toEqual(["模型", "軟體"]);
  });

  it("lookup prefers the most specific entry for the same source term", () => {
    store.add({ sourceTerm: "color", targetTerm: "couleur", sourceLang: "en", targetLang: "fr" });
    store.add({ sourceTerm: "color", targetTerm: "teinte", sourceLang: "en-US", targetLang: "fr" });
    store.add({ sourceTerm: "truck", targetTerm: "camion", sourceLang: "en", targetLang: "fr" });
    const entries = store.lookup("en-US", "fr");
    expect(entries.map((e) => `${e.sourceTerm}=${e.targetTerm}`).sort()).toEqual(["color=teinte", "truck=camion"]);
    // Base query still sees only the base entry
    expect(store.lookup("en", "fr").map((e) => e.targetTerm).sort()).toEqual(["camion", "couleur"]);
  });

  it("lookup prefers a target-region entry over a base-target entry", () => {
    store.add({ sourceTerm: "email", targetTerm: "e-mail", sourceLang: "en", targetLang: "fr" });
    store.add({ sourceTerm: "email", targetTerm: "courriel", sourceLang: "en", targetLang: "fr-CA" });
    expect(store.lookup("en", "fr-CA").map((e) => e.targetTerm)).toEqual(["courriel"]);
    expect(store.lookup("en", "fr-FR").map((e) => e.targetTerm)).toEqual(["e-mail"]);
  });

  it("findMatches uses language fallback", () => {
    store.add({ sourceTerm: "API", targetTerm: "interface", sourceLang: "en", targetLang: "fr" });
    expect(store.findMatches("The API is ready", "en-US", "fr-CA")).toHaveLength(1);
  });

  it("findMatches delegates to matchTerms", () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const hits = store.findMatches("The API is ready", "en", "ar");
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.targetTerm).toBe("واجهة برمجة");
  });
});
