import { describe, test, expect } from "bun:test";
import { parseDocument } from "yaml";
import { regenerateI18nextPlurals, regenerateYamlPlurals, pathKey, isCountPlaceholder } from "../i18next";

const EN = { item_one: "{{count}} item", item_other: "{{count}} items" };

describe("regenerateI18nextPlurals", () => {
  test("en→ar emits all six Arabic categories in CLDR order, in place of the group", () => {
    const r = regenerateI18nextPlurals({ before: "a", ...EN, after: "b" }, "en", "ar");
    expect(Object.keys(r.data as object)).toEqual([
      "before", "item_zero", "item_one", "item_two", "item_few", "item_many", "item_other", "after",
    ]);
    const d = r.data as Record<string, string>;
    // Base text is the same category when the source has it, else `_other`.
    expect(d.item_one).toBe("{{count}} item");
    expect(d.item_two).toBe("{{count}} items");
    expect(d.item_other).toBe("{{count}} items");
    expect(r.hints.get(pathKey(["item_two"]))).toEqual({ value: 2, exact: true });
    expect(r.hints.get(pathKey(["item_few"]))).toEqual({ value: 3, exact: false });
    expect(r.hints.get(pathKey(["before"]))).toBeUndefined();
    expect(r.unresolved).toBe(false);
  });

  test("en→ja drops source-only categories; the sample fits the `_other` base text", () => {
    const r = regenerateI18nextPlurals(EN, "en", "ja");
    expect(r.data).toEqual({ item_other: "{{count}} items" });
    expect(r.hints.get(pathKey(["item_other"]))).toEqual({ value: 2, exact: false });
  });

  test("en→ru uses `_other` for few/many; fraction-only `other` gets no sample", () => {
    const r = regenerateI18nextPlurals(EN, "en", "ru");
    expect(Object.keys(r.data as object)).toEqual(["item_one", "item_few", "item_many", "item_other"]);
    expect((r.data as Record<string, string>).item_few).toBe("{{count}} items");
    expect((r.data as Record<string, string>).item_other).toBe("{{count}} items");
    expect(r.hints.has(pathKey(["item_other"]))).toBe(false);
  });

  test("with an unknown source language, bases each form on the same category or `_other`", () => {
    const r = regenerateI18nextPlurals(EN, "auto", "ja");
    expect(r.data).toEqual({ item_other: "{{count}} items" });
    // Without source rules, 1 is still avoided for `_other` text: it is the singular in nearly every language.
    expect(r.hints.get(pathKey(["item_other"]))?.value).toBe(2);
  });

  test("keeps a source `_zero` even when the target has no zero category (i18next count===0 override)", () => {
    const r = regenerateI18nextPlurals({ item_zero: "No items", ...EN }, "en", "ja");
    expect(r.data).toEqual({ item_zero: "No items", item_other: "{{count}} items" });
    expect(r.hints.get(pathKey(["item_zero"]))).toEqual({ value: 0, exact: true });
  });

  test("source `_zero` is the base for a target zero category", () => {
    const r = regenerateI18nextPlurals({ item_zero: "No items", ...EN }, "en", "ar");
    expect((r.data as Record<string, string>).item_zero).toBe("No items");
  });

  test("ordinal groups use ordinal categories", () => {
    const src = {
      place_ordinal_one: "{{count}}st place",
      place_ordinal_two: "{{count}}nd place",
      place_ordinal_few: "{{count}}rd place",
      place_ordinal_other: "{{count}}th place",
    };
    const ar = regenerateI18nextPlurals(src, "en", "ar");
    // Arabic has only an `other` ordinal; its sample (4) is also "-th" in English.
    expect(ar.data).toEqual({ place_ordinal_other: "{{count}}th place" });
    expect(ar.hints.get(pathKey(["place_ordinal_other"]))?.value).toBe(4);
    const fr = regenerateI18nextPlurals(src, "en", "fr");
    expect(fr.data).toEqual({ place_ordinal_one: "{{count}}st place", place_ordinal_other: "{{count}}th place" });
  });

  test("cardinal and ordinal groups with the same stem are independent", () => {
    const r = regenerateI18nextPlurals({ ...EN, item_ordinal_one: "1st", item_ordinal_other: "nth" }, "en", "ja");
    expect(r.data).toEqual({ item_other: "{{count}} items", item_ordinal_other: "nth" });
  });

  test("recurses into nested objects and arrays", () => {
    const r = regenerateI18nextPlurals({ a: { b: [{ ...EN }] } }, "en", "ja");
    expect(r.data).toEqual({ a: { b: [{ item_other: "{{count}} items" }] } });
    expect(r.hints.has(pathKey(["a", "b", 0, "item_other"]))).toBe(true);
  });

  test("context + plural keys group by the full stem", () => {
    const r = regenerateI18nextPlurals({ friend_male_one: "a boyfriend", friend_male_other: "{{count}} boyfriends" }, "en", "ja");
    expect(Object.keys(r.data as object)).toEqual(["friend_male_other"]);
  });

  test("leaves non-plural look-alikes alone", () => {
    // No `_other` member → not an i18next plural group.
    const steps = { step_one: "Install", step_two: "Configure", step_three: "Run" };
    expect(regenerateI18nextPlurals(steps, "en", "ar").data).toEqual(steps);
    // A lone `_other` is ambiguous unless the source language has only `other`.
    expect(regenerateI18nextPlurals({ gender_other: "Other" }, "en", "ar").data).toEqual({ gender_other: "Other" });
    // Non-string members → not a translatable group.
    const nested = { item_one: { a: "x" }, item_other: "y" };
    expect(regenerateI18nextPlurals(nested, "en", "ar").data).toEqual(nested);
  });

  test("a lone `_other` group is regenerated when the source language has only `other`", () => {
    const r = regenerateI18nextPlurals({ item_other: "{{count}} 個" }, "ja", "en");
    expect(r.data).toEqual({ item_one: "{{count}} 個", item_other: "{{count}} 個" });
  });

  test("rejects a look-alike group with a category the source language does not use", () => {
    // en has no cardinal `two`: player_one/two/other are three players, not plural forms.
    const players = { player_one: "Player 1", player_two: "Player 2", player_other: "Other players" };
    expect(regenerateI18nextPlurals(players, "en", "ja").data).toEqual(players);
    // `_zero` is always allowed (i18next's count === 0 override).
    const zero = { item_zero: "No items", ...EN };
    expect(Object.keys(regenerateI18nextPlurals(zero, "en", "ja").data as object)).toEqual(["item_zero", "item_other"]);
    // Ordinal `two` is an English ordinal category.
    const ord = { p_ordinal_one: "1st", p_ordinal_two: "2nd", p_ordinal_other: "nth" };
    expect(Object.keys(regenerateI18nextPlurals(ord, "en", "ja").data as object)).toEqual(["p_ordinal_other"]);
  });

  test("reports lone `_other` keys when the source language is auto", () => {
    const r = regenerateI18nextPlurals({ a: { item_other: "{{count}} 個" }, ...EN }, "auto", "en");
    expect(r.loneOther).toEqual(["a.item_other"]);
    expect((r.data as { a: object }).a).toEqual({ item_other: "{{count}} 個" });
    // With a known source language the lone key is either a group (ja) or a look-alike (en): no report.
    expect(regenerateI18nextPlurals({ gender_other: "Other", ...EN }, "en", "ar").loneOther).toEqual([]);
  });

  test("skips sample counts that already appear as literal numbers in the text", () => {
    const src = { f_one: "{{count}} file in 5 folders", f_other: "{{count}} files in 5 folders" };
    const r = regenerateI18nextPlurals(src, "en", "ru");
    // ru `many` would be 5 — taken by "5 folders" — so the next many-number is used.
    expect(r.hints.get(pathKey(["f_many"]))).toEqual({ value: 6, exact: false });
    expect(r.hints.get(pathKey(["f_few"]))).toEqual({ value: 2, exact: false });
  });

  test("no collision-free sample → the form is marked for a plain translation", () => {
    const src = { f_one: "{{count}} file, 2 folders", f_other: "{{count}} files, 2 folders" };
    const r = regenerateI18nextPlurals(src, "en", "ar");
    // ar `two` is only 2, which the text already uses.
    expect(r.hints.has(pathKey(["f_two"]))).toBe(true);
    expect(r.hints.get(pathKey(["f_two"]))).toBeNull();
  });

  test("categories whose smallest sample is a million are generated but get no sample", () => {
    const r = regenerateI18nextPlurals(EN, "en", "fr");
    // i18next does not fall back from `key_many` to `key_other`, so the key must exist.
    expect(r.data).toEqual({ item_one: "{{count}} item", item_many: "{{count}} items", item_other: "{{count}} items" });
    expect(r.hints.has(pathKey(["item_many"]))).toBe(false);
  });

  test("unknown target locale leaves the group as-is and reports it", () => {
    const r = regenerateI18nextPlurals(EN, "en", "xx");
    expect(r.data).toEqual(EN);
    expect(r.unresolved).toBe(true);
  });

  test("does not mutate the input", () => {
    const src = { ...EN };
    regenerateI18nextPlurals(src, "en", "ar");
    expect(src).toEqual(EN);
  });
});

describe("regenerateYamlPlurals", () => {
  test("rewrites the group in place and matches the data plan", () => {
    const text = "title: Hi\n# Item counts\nitem_one: \"{{count}} item\" # singular\nitem_other: \"{{count}} items\"\nend: Bye\n";
    const doc = parseDocument(text);
    regenerateYamlPlurals(doc, "en", "ar");
    const expected = regenerateI18nextPlurals(parseDocument(text).toJS(), "en", "ar").data;
    expect(doc.toJS()).toEqual(expected);
    const out = doc.toString();
    // The comment above the group survives once, above the first generated key; quoting is kept.
    expect(out.match(/# Item counts/g)?.length).toBe(1);
    expect(out).toContain("# Item counts\nitem_zero: \"{{count}} items\"\n");
    expect(out.match(/# singular/g)).toBeNull();
    expect(out.startsWith("title: Hi\n")).toBe(true);
    expect(out.endsWith("end: Bye\n")).toBe(true);
  });

  test("nested maps", () => {
    const doc = parseDocument("cart:\n  item_one: one\n  item_other: many\n");
    regenerateYamlPlurals(doc, "en", "ja");
    expect(doc.toString()).toBe("cart:\n  item_other: many\n");
  });
});

describe("isCountPlaceholder", () => {
  test("matches the i18next count variable only", () => {
    expect(isCountPlaceholder("{{count}}")).toBe(true);
    expect(isCountPlaceholder("{{ count }}")).toBe(true);
    expect(isCountPlaceholder("{{name}}")).toBe(false);
    expect(isCountPlaceholder("{count}")).toBe(false);
  });
});
