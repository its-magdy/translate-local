import { describe, test, expect } from "bun:test";
import { normalizeLang, isSupported, langFallbackChain } from "../utils/language";

describe("normalizeLang", () => {
  test("lowercases language code", () => {
    expect(normalizeLang("EN")).toBe("en");
    expect(normalizeLang("AR")).toBe("ar");
    expect(normalizeLang("zh-CN")).toBe("zh-cn");
  });

  test("passes through already lowercase codes", () => {
    expect(normalizeLang("en")).toBe("en");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeLang("  EN  ")).toBe("en");
    expect(normalizeLang(" ar")).toBe("ar");
  });
});

describe("isSupported", () => {
  test("returns true for supported languages", () => {
    expect(isSupported("ar")).toBe(true);
    expect(isSupported("zh")).toBe(true);
    expect(isSupported("fil")).toBe(true);
  });

  test("handles uppercase input", () => {
    expect(isSupported("AR")).toBe(true);
  });

  test("accepts BCP-47 tags with regional subtags via base-code fallback", () => {
    // zh-cn is NOT in SUPPORTED_LANGUAGES; "zh" base code is — exercises the fallback
    expect(isSupported("zh-CN")).toBe(true);
    // pt-BR is NOT in SUPPORTED_LANGUAGES; "pt" base code is
    expect(isSupported("pt-BR")).toBe(true);
    // zh-XX: unknown subtag, but base "zh" is supported
    expect(isSupported("zh-XX")).toBe(true);
  });

  test("returns false for unsupported languages", () => {
    expect(isSupported("xx")).toBe(false);
    expect(isSupported("tlh")).toBe(false); // Klingon not supported
  });
});

describe("langFallbackChain", () => {
  test("returns just the base for a bare language", () => {
    expect(langFallbackChain("en")).toEqual(["en"]);
  });

  test("lowercases and truncates region subtags", () => {
    expect(langFallbackChain("en-US")).toEqual(["en-us", "en"]);
    expect(langFallbackChain(" EN-us ")).toEqual(["en-us", "en"]);
  });

  test("walks script + region down one subtag at a time", () => {
    expect(langFallbackChain("zh-Hant-TW")).toEqual(["zh-hant-tw", "zh-hant", "zh"]);
  });

  test("drops a trailing singleton when truncating (RFC 4647 §3.4 example)", () => {
    expect(langFallbackChain("zh-Hant-CN-x-private1-private2")).toEqual([
      "zh-hant-cn-x-private1-private2",
      "zh-hant-cn-x-private1",
      "zh-hant-cn",
      "zh-hant",
      "zh",
    ]);
  });
});
