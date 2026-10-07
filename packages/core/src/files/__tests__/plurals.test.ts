import { describe, test, expect } from "bun:test";
import { pluralRules, pluralCategories, pluralSample, sampleRegex } from "../plurals";

describe("pluralCategories", () => {
  test("cardinal categories in canonical CLDR order", () => {
    expect(pluralCategories("en")).toEqual(["one", "other"]);
    expect(pluralCategories("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(pluralCategories("ru")).toEqual(["one", "few", "many", "other"]);
    expect(pluralCategories("fr")).toEqual(["one", "many", "other"]);
    expect(pluralCategories("ja")).toEqual(["other"]);
    expect(pluralCategories("zh-CN")).toEqual(["other"]);
  });

  test("ordinal categories", () => {
    expect(pluralCategories("en", "ordinal")).toEqual(["one", "two", "few", "other"]);
    expect(pluralCategories("ar", "ordinal")).toEqual(["other"]);
    expect(pluralCategories("fr", "ordinal")).toEqual(["one", "other"]);
  });

  test("null when Intl cannot resolve the language (no silent fallback to the runtime locale)", () => {
    expect(pluralCategories("xx")).toBeNull();
    expect(pluralCategories("not a tag!")).toBeNull();
    expect(pluralRules("xx")).toBeNull();
  });
});

describe("pluralSample", () => {
  test("picks the smallest positive integer in the category", () => {
    expect(pluralSample("ar", "few")).toEqual({ value: 3, exact: false });
    expect(pluralSample("ar", "many")).toEqual({ value: 11, exact: false });
    expect(pluralSample("ar", "other")).toEqual({ value: 100, exact: false });
    expect(pluralSample("ru", "many")).toEqual({ value: 5, exact: false });
    expect(pluralSample("fr", "many")?.value).toBe(1000000);
  });

  test("exact when the category holds a single number", () => {
    expect(pluralSample("ar", "zero")).toEqual({ value: 0, exact: true });
    expect(pluralSample("ar", "one")).toEqual({ value: 1, exact: true });
    expect(pluralSample("ar", "two")).toEqual({ value: 2, exact: true });
    expect(pluralSample("en", "one")).toEqual({ value: 1, exact: true });
    // ru `one` is 1, 21, 31, … and fr `one` is 0 and 1 — dropping the number is not safe.
    expect(pluralSample("ru", "one")).toEqual({ value: 1, exact: false });
    expect(pluralSample("fr", "one")).toEqual({ value: 1, exact: false });
    // fr `many` is every multiple of a million, not just 1e6.
    expect(pluralSample("fr", "many")?.exact).toBe(false);
  });

  test("falls back to a decimal when no integer is in the category", () => {
    expect(pluralSample("ru", "other")).toEqual({ value: 1.5, exact: false });
  });

  test("prefer picks the first accepted value, else the first in the category", () => {
    expect(pluralSample("ja", "other")).toEqual({ value: 1, exact: false });
    expect(pluralSample("ja", "other", "cardinal", (n) => n !== 1)).toEqual({ value: 2, exact: false });
    expect(pluralSample("ar", "one", "cardinal", (n) => n !== 1)).toEqual({ value: 1, exact: true });
    expect(pluralSample("ar", "zero", "cardinal", (n) => n === 0)).toEqual({ value: 0, exact: true });
  });

  test("ordinal samples", () => {
    expect(pluralSample("en", "two", "ordinal")).toEqual({ value: 2, exact: false });
    expect(pluralSample("ar", "other", "ordinal")?.value).toBe(1);
  });

  test("null for a category the locale does not use, or an unknown locale", () => {
    expect(pluralSample("ja", "one")).toBeNull();
    expect(pluralSample("xx", "other")).toBeNull();
  });
});

describe("sampleRegex", () => {
  test("matches ASCII and locale-formatted numbers as whole tokens", () => {
    expect("3 ملفات".match(sampleRegex(3, "ar"))?.length).toBe(1);
    expect("1,5 файла".match(sampleRegex(1.5, "ru"))?.length).toBe(1);
    expect("1.5 файла".match(sampleRegex(1.5, "ru"))?.length).toBe(1);
    expect("۳ فایل".match(sampleRegex(3, "fa"))?.length).toBe(1);
  });

  test("matches large numbers with or without digit grouping", () => {
    for (const s of ["1000000 de fichiers", "1 000 000 de fichiers", "1 000 000 de fichiers", "1,000,000 files", "1.000.000 Dateien"]) {
      expect(s.match(sampleRegex(1000000, "fr"))?.length).toBe(1);
    }
    expect("10000000 files".match(sampleRegex(1000000, "en"))).toBeNull();
  });

  test("does not match inside a longer number", () => {
    expect("13 files".match(sampleRegex(3, "en"))).toBeNull();
    expect("3.5 files".match(sampleRegex(3, "en"))).toBeNull();
    expect("1000 files".match(sampleRegex(100, "en"))).toBeNull();
  });

  test("does not match digits inside identifiers such as placeholder sentinels", () => {
    expect("يتبقى يوم واحد، __TLPH_1__".match(sampleRegex(1, "ar"))).toBeNull();
    expect("__TLPH_12__".match(sampleRegex(2, "en"))).toBeNull();
    expect("mp3 files".match(sampleRegex(3, "en"))).toBeNull();
    // A suffix after the number is fine: ordinals ("1st", "2e") and CJK counters.
    expect("1st place".match(sampleRegex(1, "en"))?.length).toBe(1);
    expect("第1位".match(sampleRegex(1, "ja"))?.length).toBe(1);
  });
});
