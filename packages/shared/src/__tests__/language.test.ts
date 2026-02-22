import { describe, test, expect } from "bun:test";
import { normalizeLang, isSupported } from "../utils/language";

describe("normalizeLang", () => {
  test("lowercases language code", () => {
    expect(normalizeLang("EN")).toBe("en");
    expect(normalizeLang("AR")).toBe("ar");
    expect(normalizeLang("zh-CN")).toBe("zh-cn");
  });

  test("passes through already lowercase codes", () => {
    expect(normalizeLang("en")).toBe("en");
  });
});

describe("isSupported", () => {
  test("returns true for supported languages", () => {
    expect(isSupported("en")).toBe(true);
    expect(isSupported("ar")).toBe(true);
    expect(isSupported("zh")).toBe(true);
  });

  test("handles uppercase input", () => {
    expect(isSupported("EN")).toBe(true);
  });

  test("returns false for unsupported languages", () => {
    expect(isSupported("xx")).toBe(false);
    expect(isSupported("tlh")).toBe(false); // Klingon not supported
  });
});
