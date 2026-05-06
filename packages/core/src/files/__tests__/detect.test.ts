import { describe, test, expect } from "bun:test";
import { detect, detectContentFormat, parseFormatFromExt } from "../detect";

describe("parseFormatFromExt", () => {
  test(".json", () => {
    expect(parseFormatFromExt(".json")).toBe("json");
    expect(parseFormatFromExt(".JSON")).toBe("json");
  });

  test(".yaml and .yml", () => {
    expect(parseFormatFromExt(".yaml")).toBe("yaml");
    expect(parseFormatFromExt(".yml")).toBe("yaml");
  });

  test("unknown returns null", () => {
    expect(parseFormatFromExt(".txt")).toBeNull();
    expect(parseFormatFromExt(".po")).toBeNull();
    expect(parseFormatFromExt("")).toBeNull();
  });
});

describe("detectContentFormat", () => {
  test("plain nested object → vanilla", () => {
    expect(detectContentFormat({ a: { b: "c" } })).toBe("vanilla");
  });

  test("xcstrings shape", () => {
    const xc = {
      sourceLanguage: "en",
      version: "1.0",
      strings: {
        hello: { localizations: { en: { stringUnit: { state: "translated", value: "Hello" } } } },
      },
    };
    expect(detectContentFormat(xc as never)).toBe("xcstrings");
  });

  test("ARB with @key metadata", () => {
    const arb = {
      hello: "Hello {name}",
      "@hello": { description: "greeting", placeholders: { name: { type: "String" } } },
    };
    expect(detectContentFormat(arb as never)).toBe("arb");
  });

  test("ARB with only @@locale", () => {
    expect(detectContentFormat({ "@@locale": "en", greeting: "Hi" } as never)).toBe("arb");
  });

  test("FormatJS catalog", () => {
    const fj = { hak27d: { defaultMessage: "Save", description: "save button" } };
    expect(detectContentFormat(fj as never)).toBe("formatjs");
  });

  test("Lingui full mode", () => {
    const lg = { greeting: { translation: "Hello", message: "Hello", description: "" } };
    expect(detectContentFormat(lg as never)).toBe("lingui-full");
  });

  test("i18next plurals", () => {
    const i18 = { item_one: "{{count}} item", item_other: "{{count}} items" };
    expect(detectContentFormat(i18 as never)).toBe("i18next-plurals");
  });

  test("a single _other key without sibling stem is still vanilla", () => {
    const i18 = { item_other: "items" };
    expect(detectContentFormat(i18 as never)).toBe("vanilla");
  });

  test("non-object root is vanilla", () => {
    expect(detectContentFormat([] as never)).toBe("vanilla");
    expect(detectContentFormat(null as never)).toBe("vanilla");
  });
});

describe("detect (full resolution)", () => {
  test("vanilla JSON is supported", () => {
    const r = detect(".json", { hello: "world" }, "auto");
    expect(r.parse).toBe("json");
    expect(r.content).toBe("vanilla");
    expect(r.supported).toBe(true);
  });

  test("ARB is refused", () => {
    const r = detect(".arb", { "@hello": {}, hello: "Hi" } as never, "auto");
    // .arb extension isn't recognized; content detection still runs because parse defaults to json via override
    // Actually .arb returns null from parseFormatFromExt → unsupported extension
    expect(r.supported).toBe(false);
  });

  test("ARB content with .json extension is refused on content", () => {
    const r = detect(".json", { "@hello": {}, hello: "Hi" } as never, "auto");
    expect(r.content).toBe("arb");
    expect(r.supported).toBe(false);
    expect(r.refusalHint).toContain("Flutter ARB");
  });

  test("xcstrings refused", () => {
    const xc = { sourceLanguage: "en", version: "1.0", strings: {} };
    const r = detect(".json", xc as never, "auto");
    expect(r.content).toBe("xcstrings");
    expect(r.supported).toBe(false);
  });

  test("FormatJS refused", () => {
    const fj = { id1: { defaultMessage: "Save" } };
    const r = detect(".json", fj as never, "auto");
    expect(r.content).toBe("formatjs");
    expect(r.supported).toBe(false);
  });

  test("--format raw-json bypasses content checks", () => {
    const xc = { sourceLanguage: "en", version: "1.0", strings: {} };
    const r = detect(".json", xc as never, "raw-json");
    expect(r.supported).toBe(true);
    expect(r.raw).toBe(true);
    expect(r.content).toBe("vanilla");
  });

  test("--format yaml override", () => {
    const r = detect(".txt", { a: "b" }, "yaml");
    expect(r.parse).toBe("yaml");
    expect(r.supported).toBe(true);
  });

  test("unknown extension without override is refused", () => {
    const r = detect(".xliff", { a: "b" }, "auto");
    expect(r.supported).toBe(false);
    expect(r.refusalHint).toContain("Unsupported extension");
  });

  test("i18next-plurals is supported (with downstream warning)", () => {
    const r = detect(".json", { item_one: "x", item_other: "y" } as never, "auto");
    expect(r.content).toBe("i18next-plurals");
    expect(r.supported).toBe(true);
  });
});
