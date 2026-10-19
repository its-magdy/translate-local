import { describe, test, expect } from "bun:test";
import { TlError } from "@translate-local/shared/errors";
import { rebaseLocaleRoot } from "../locale-root";

describe("rebaseLocaleRoot", () => {
  const source = { en: { greeting: "Hello" } };

  test("re-roots a locale-rooted source under the target locale", () => {
    expect(rebaseLocaleRoot(source, undefined, "en", "fr")).toEqual({
      source: { fr: { greeting: "Hello" } },
      rename: { from: "en", to: "fr" },
    });
  });

  test("matches the locale case-insensitively, with - and _ interchangeable", () => {
    const r = rebaseLocaleRoot({ pt_BR: { a: "x" } }, undefined, "pt-br", "fr");
    expect(r?.rename).toEqual({ from: "pt_BR", to: "fr" });
  });

  test("returns null when the source is not locale-rooted", () => {
    expect(rebaseLocaleRoot({ app: { a: "x" } }, undefined, "en", "fr")).toBeNull();
    expect(rebaseLocaleRoot({ en: { a: "x" }, other: "y" }, undefined, "en", "fr")).toBeNull();
    expect(rebaseLocaleRoot({ en: "Hello" }, undefined, "en", "fr")).toBeNull();
    expect(rebaseLocaleRoot(["x"], undefined, "en", "fr")).toBeNull();
    expect(rebaseLocaleRoot(source, undefined, undefined, "fr")).toBeNull();
  });

  test("keeps the existing target's spelling of the target locale", () => {
    const r = rebaseLocaleRoot(source, { fr_FR: { greeting: "Bonjour" } }, "en", "fr-FR");
    expect(r?.rename).toEqual({ from: "en", to: "fr_FR" });
    expect(r?.source).toEqual({ fr_FR: { greeting: "Hello" } });
    expect(r?.warning).toBeUndefined();
  });

  test("refuses an existing target rooted at the source locale", () => {
    let err: unknown;
    try {
      rebaseLocaleRoot(source, { EN: { greeting: "Bonjour" } }, "en", "fr");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TlError);
    expect((err as TlError).tag).toBe("FILE_INVALID_FORMAT");
    expect((err as TlError).message).toContain('"EN"');
  });

  test("warns when the existing target has keys but no target root", () => {
    const r = rebaseLocaleRoot(source, { ar: { greeting: "مرحبا" } }, "en", "fr");
    expect(r?.rename).toEqual({ from: "en", to: "fr" });
    expect(r?.warning).toMatch(/no "fr" root key \(found: ar\)/);
  });

  test("an empty existing target gets no warning", () => {
    expect(rebaseLocaleRoot(source, {}, "en", "fr")?.warning).toBeUndefined();
  });
});
