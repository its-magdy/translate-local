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
