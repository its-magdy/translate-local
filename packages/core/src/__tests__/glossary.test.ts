import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GlossaryStore, matchTerms } from "../glossary";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GlossaryEntry } from "@tl/shared/types";

describe("matchTerms", () => {
  const entry = (sourceTerm: string, targetTerm: string): GlossaryEntry => ({
    id: "1",
    sourceTerm,
    targetTerm,
    sourceLang: "en",
    targetLang: "ar",
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

  it("does not match CJK term when adjacent to other CJK characters", () => {
    // CJK has no word boundaries; adjacent letters prevent matching
    // This is expected — CJK glossary matching requires punctuation/space delimiters
    const hits = matchTerms("我喜欢机器学习技术", [entry("机器学习", "machine learning")]);
    expect(hits).toHaveLength(0);
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

  it("findMatches delegates to matchTerms", () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const hits = store.findMatches("The API is ready", "en", "ar");
    expect(hits).toHaveLength(1);
    expect(hits[0].entry.targetTerm).toBe("واجهة برمجة");
  });
});
