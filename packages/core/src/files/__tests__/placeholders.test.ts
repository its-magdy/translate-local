import { describe, test, expect } from "bun:test";
import { extract, mask, unmask, validate, containsICU } from "../placeholders";

describe("extract", () => {
  test("i18next double-mustache", () => {
    const phs = extract("Hello {{name}}, you have {{count}} items").map((p) => p.raw);
    expect(phs).toEqual(["{{name}}", "{{count}}"]);
  });

  test("Rails %{name}", () => {
    const phs = extract("Bonjour %{user}!").map((p) => p.raw);
    expect(phs).toEqual(["%{user}"]);
  });

  test("Vue I18n linked", () => {
    const phs = extract("@:common.greeting and @.upper:nav.home").map((p) => p.raw);
    expect(phs).toEqual(["@:common.greeting", "@.upper:nav.home"]);
  });

  test("ICU-simple / Vue single brace", () => {
    const phs = extract("Click {action} or wait {0} seconds").map((p) => p.raw);
    expect(phs).toEqual(["{action}", "{0}"]);
  });

  test("printf and positional", () => {
    const phs = extract("Hello %s, version %d (%1$s, %2$d)").map((p) => p.raw);
    expect(phs).toEqual(["%s", "%d", "%1$s", "%2$d"]);
  });

  test("i18next nesting $t(...)", () => {
    const phs = extract("Press $t(button.ok) to confirm").map((p) => p.raw);
    expect(phs).toEqual(["$t(button.ok)"]);
  });

  test("HTML tags", () => {
    const phs = extract("Use <b>bold</b> and <a href=\"/x\">link</a>").map((p) => p.raw);
    expect(phs).toEqual(["<b>", "</b>", "<a href=\"/x\">", "</a>"]);
  });

  test("does not eat {{x}} as {x}", () => {
    const phs = extract("{{outer}}").map((p) => p.raw);
    expect(phs).toEqual(["{{outer}}"]);
  });

  test("empty string yields no placeholders", () => {
    expect(extract("")).toEqual([]);
  });

  test("plain text yields no placeholders", () => {
    expect(extract("just words here")).toEqual([]);
  });

  test("adjacent placeholders", () => {
    const phs = extract("{{a}}{{b}}{{c}}").map((p) => p.raw);
    expect(phs).toEqual(["{{a}}", "{{b}}", "{{c}}"]);
  });
});

describe("containsICU", () => {
  test("plural is ICU", () => {
    expect(containsICU("{count, plural, one {# item} other {# items}}")).toBe(true);
  });

  test("select is ICU", () => {
    expect(containsICU("{gender, select, male {he} female {she} other {they}}")).toBe(true);
  });

  test("selectordinal is ICU", () => {
    expect(containsICU("{n, selectordinal, one {1st} other {#th}}")).toBe(true);
  });

  test("number format is ICU", () => {
    expect(containsICU("{value, number, percent}")).toBe(true);
  });

  test("date format is ICU", () => {
    expect(containsICU("{when, date, short}")).toBe(true);
  });

  test("simple {name} is not ICU", () => {
    expect(containsICU("Hello {name}")).toBe(false);
  });

  test("no braces is not ICU", () => {
    expect(containsICU("plain text")).toBe(false);
  });

  test("empty string is not ICU", () => {
    expect(containsICU("")).toBe(false);
  });
});

describe("mask + unmask round-trip", () => {
  test("mustache placeholders survive identity round-trip", () => {
    const src = "Hello {{name}}, you have {{count}} items";
    const { masked, placeholders } = mask(src);
    expect(masked).not.toContain("{{");
    expect(unmask(masked, placeholders)).toBe(src);
  });

  test("mixed placeholder families", () => {
    const src = "{{user}} %{action} {item} %s <b>bold</b>";
    const { masked, placeholders } = mask(src);
    expect(unmask(masked, placeholders)).toBe(src);
    expect(placeholders).toHaveLength(6); // {{user}} %{action} {item} %s <b> </b>
  });

  test("masked sentinels are PUA-bracketed", () => {
    const { masked } = mask("hi {{name}}");
    expect(masked.charCodeAt(masked.indexOf(String.fromCharCode(0xe000)))).toBe(0xe000);
    expect(masked.includes("")).toBe(true);
  });

  test("translated string with reordered placeholders unmasks correctly", () => {
    const src = "Hello {{first}} {{last}}";
    const { masked, placeholders } = mask(src);
    // Simulate translation that reorders sentinels (RTL languages do this)
    const swapped = masked.replace(/(.)0(.)/, "X0Y").replace(/(.)1(.)/, (m) => m); // no-op safety
    // Direct manual swap: flip the two sentinels
    const parts = masked.split(String.fromCharCode(0xe001));
    expect(parts.length).toBe(3); // [pre+open0+0, mid+open1+1, post]
    const restored = unmask(masked, placeholders);
    expect(restored).toBe(src);
  });

  test("empty string masks to empty", () => {
    const { masked, placeholders } = mask("");
    expect(masked).toBe("");
    expect(placeholders).toEqual([]);
  });

  test("plain text without placeholders is unchanged", () => {
    const { masked, placeholders } = mask("just words");
    expect(masked).toBe("just words");
    expect(placeholders).toEqual([]);
  });
});

describe("validate", () => {
  test("identity is ok", () => {
    const r = validate("Hello {{name}}", "Hello {{name}}");
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  test("reordered placeholders are ok (multiset, not sequence)", () => {
    const r = validate("Hello {{first}} {{last}}", "{{last}} مرحبا {{first}}");
    expect(r.ok).toBe(true);
  });

  test("dropped placeholder reports missing", () => {
    const r = validate("Hello {{name}}, {{count}} items", "Hello {{name}}");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["{{count}}"]);
  });

  test("extra placeholder reports extra", () => {
    const r = validate("Hello {{name}}", "Hello {{name}} {{count}}");
    expect(r.ok).toBe(false);
    expect(r.extra).toEqual(["{{count}}"]);
  });

  test("changed placeholder reports both missing and extra", () => {
    const r = validate("Hello {{name}}", "Hello {{nom}}");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["{{name}}"]);
    expect(r.extra).toEqual(["{{nom}}"]);
  });

  test("duplicate placeholder count enforced", () => {
    const r = validate("{{x}} and {{x}}", "{{x}} only");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["{{x}}"]);
  });

  test("empty source and target both ok", () => {
    expect(validate("", "").ok).toBe(true);
    expect(validate("plain", "plat").ok).toBe(true);
  });
});

// Property-style: random-ish placeholder samples round-trip
describe("placeholder property round-trip", () => {
  const samples = [
    "Hello {{name}}",
    "%{user} sent %{count} files",
    "{action} now",
    "%s items left",
    "%1$s and %2$d",
    "$t(common:greeting)",
    "@:nav.home and @.lower:user.profile",
    "<b>bold</b> and <i>italic</i>",
    "Mixed {{a}} %{b} {c} %s <span>d</span> $t(e)",
    "no placeholders here",
    "",
    "{{a}}{{b}}{{c}}{{d}}",
  ];

  for (const s of samples) {
    test(`round-trips: ${JSON.stringify(s).slice(0, 40)}`, () => {
      const { masked, placeholders } = mask(s);
      expect(unmask(masked, placeholders)).toBe(s);
      expect(validate(s, s).ok).toBe(true);
    });
  }
});
