import { describe, it, expect } from "vitest";
import { languages, getLanguageName } from "../src/lib/languages";

describe("languages", () => {
  it("exports valid BCP-47 codes (2-3 chars lowercase)", () => {
    for (const lang of languages) {
      expect(lang.code).toMatch(/^[a-z]{2,3}$/);
    }
  });

  it("has no duplicate codes", () => {
    const codes = languages.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has 75+ languages", () => {
    expect(languages.length).toBeGreaterThanOrEqual(75);
  });
});

describe("getLanguageName", () => {
  it("returns correct names for known codes", () => {
    expect(getLanguageName("en")).toBe("English");
    expect(getLanguageName("ar")).toBe("Arabic");
    expect(getLanguageName("ja")).toBe("Japanese");
  });

  it("returns the code itself for unknown codes", () => {
    expect(getLanguageName("zz")).toBe("zz");
    expect(getLanguageName("xxx")).toBe("xxx");
  });
});
