import { describe, test, expect } from "bun:test";
import { diffForSync, makeEmptyTargetLike, pruneTarget } from "../sync";
import type { JsonValue } from "../walk";

describe("diffForSync (missing-only)", () => {
  test("translates missing keys", () => {
    const src: JsonValue = { hello: "world", foo: "bar" };
    const tgt: JsonValue = { hello: "monde" };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["foo"]]);
  });

  test("translates empty-string targets", () => {
    const src: JsonValue = { hello: "world", foo: "bar" };
    const tgt: JsonValue = { hello: "monde", foo: "" };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["foo"]]);
  });

  test("translates null targets", () => {
    const src: JsonValue = { hello: "world" };
    const tgt: JsonValue = { hello: null };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["hello"]]);
  });

  test("translates whitespace-only targets", () => {
    const src: JsonValue = { hello: "world" };
    const tgt: JsonValue = { hello: "  \n\t " };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["hello"]]);
  });

  test("preserves existing non-empty values", () => {
    const src: JsonValue = { hello: "world", bye: "later" };
    const tgt: JsonValue = { hello: "monde", bye: "ciao" };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending).toEqual([]);
  });

  test("empty target gets everything", () => {
    const src: JsonValue = { a: "1", b: "2" };
    const pending = diffForSync(src, {}, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["a"], ["b"]]);
  });

  test("nested missing", () => {
    const src: JsonValue = { auth: { login: "Login", signup: "Sign up" } };
    const tgt: JsonValue = { auth: { login: "Connexion" } };
    const pending = diffForSync(src, tgt, "missing-only");
    expect(pending.map((p) => p.path)).toEqual([["auth", "signup"]]);
  });
});

describe("diffForSync (force)", () => {
  test("re-translates everything regardless of target", () => {
    const src: JsonValue = { hello: "world", foo: "bar" };
    const tgt: JsonValue = { hello: "monde", foo: "baz" };
    const pending = diffForSync(src, tgt, "force");
    expect(pending.map((p) => p.path)).toEqual([["hello"], ["foo"]]);
  });
});

describe("setter writes back to target tree", () => {
  test("flat key", () => {
    const src: JsonValue = { greeting: "hello" };
    const tgt: JsonValue = {};
    const pending = diffForSync(src, tgt, "missing-only");
    pending[0].set("مرحبا");
    expect(tgt).toEqual({ greeting: "مرحبا" });
  });

  test("nested key materializes intermediate object", () => {
    const src: JsonValue = { auth: { login: "Login" } };
    const tgt: JsonValue = {};
    const pending = diffForSync(src, tgt, "missing-only");
    pending[0].set("تسجيل");
    expect(tgt).toEqual({ auth: { login: "تسجيل" } });
  });

  test("array index materializes intermediate array", () => {
    const src: JsonValue = { items: ["one", "two"] };
    const tgt: JsonValue = {};
    const pending = diffForSync(src, tgt, "missing-only");
    pending[0].set("uno");
    pending[1].set("dos");
    expect(tgt).toEqual({ items: ["uno", "dos"] });
  });
});

describe("makeEmptyTargetLike", () => {
  test("shapes mirror source", () => {
    const src: JsonValue = { a: "1", nested: { b: "2" }, items: ["x", "y"] };
    expect(makeEmptyTargetLike(src)).toEqual({ a: "", nested: { b: "" }, items: ["", ""] });
  });

  test("preserves numbers/booleans/null", () => {
    const src: JsonValue = { age: 30, active: true, deleted: null, name: "alice" };
    expect(makeEmptyTargetLike(src)).toEqual({ age: 30, active: true, deleted: null, name: "" });
  });
});

describe("diffForSync (changed-source predicate)", () => {
  test("re-queues an existing target when isChanged says the source moved", () => {
    const src: JsonValue = { a: "new A", b: "B" };
    const tgt: JsonValue = { a: "old translation", b: "translated B" };
    const pending = diffForSync(src, tgt, "missing-only", (path) => path[0] === "a");
    expect(pending.map((p) => p.path)).toEqual([["a"]]);
    expect(pending[0].changed).toBe(true);
  });

  test("a changed source never re-queues a non-string target (shape mismatch)", () => {
    const src: JsonValue = { item: "Item" };
    const tgt: JsonValue = { item: { one: "x", other: "y" } };
    expect(diffForSync(src, tgt, "missing-only", () => true)).toEqual([]);
  });

  test("missing keys are not flagged as changed", () => {
    const src: JsonValue = { a: "A" };
    const tgt: JsonValue = {};
    const pending = diffForSync(src, tgt, "missing-only", () => true);
    expect(pending).toHaveLength(1);
    expect(pending[0].changed).toBe(false);
  });

  test("isChanged receives the path and source value", () => {
    const seen: [unknown, string][] = [];
    diffForSync({ n: { k: "v" } }, { n: { k: "x" } }, "missing-only", (p, s) => { seen.push([p, s]); return false; });
    expect(seen).toEqual([[["n", "k"], "v"]]);
  });
});

describe("pruneTarget", () => {
  test("removes keys absent from source and returns their paths", () => {
    const src: JsonValue = { a: "1", nested: { b: "2" } };
    const tgt: JsonValue = { a: "x", stale: "y", nested: { b: "z", old: "w" } };
    const removed = pruneTarget(src, tgt);
    expect(removed).toEqual([["stale"], ["nested", "old"]]);
    expect(tgt).toEqual({ a: "x", nested: { b: "z" } });
  });

  test("truncates arrays longer than source", () => {
    const src: JsonValue = { items: ["a", "b"] };
    const tgt: JsonValue = { items: ["x", "y", "z", "w"] };
    expect(pruneTarget(src, tgt)).toEqual([["items", 2], ["items", 3]]);
    expect(tgt).toEqual({ items: ["x", "y"] });
  });

  test("recurses into objects inside arrays", () => {
    const src: JsonValue = [{ a: "1" }];
    const tgt: JsonValue = [{ a: "x", gone: "y" }];
    expect(pruneTarget(src, tgt)).toEqual([[0, "gone"]]);
    expect(tgt).toEqual([{ a: "x" }]);
  });

  test("leaves shape mismatches alone (source string vs target map)", () => {
    const src: JsonValue = { item: "Item" };
    const tgt: JsonValue = { item: { one: "x", other: "y" } };
    expect(pruneTarget(src, tgt)).toEqual([]);
    expect(tgt).toEqual({ item: { one: "x", other: "y" } });
  });

  test("keeps target-only plural forms whose stem has plural siblings in the source", () => {
    const src: JsonValue = { cart_one: "1 item", cart_other: "{{count}} items", place_ordinal_one: "st" };
    const tgt: JsonValue = {
      cart_one: "a", cart_other: "b", cart_zero: "c", cart_two: "d", cart_few: "e", cart_many: "f",
      place_ordinal_one: "g", place_ordinal_few: "h",
    };
    expect(pruneTarget(src, tgt)).toEqual([]);
    expect(Object.keys(tgt)).toHaveLength(8);
  });

  test("keeps plural forms when the source only has the bare stem key", () => {
    const src: JsonValue = { nested: { cart: "Cart" } };
    const tgt: JsonValue = { nested: { cart: "x", cart_few: "y" } };
    expect(pruneTarget(src, tgt)).toEqual([]);
  });

  test("still prunes plural forms whose stem is gone from the source", () => {
    const src: JsonValue = { other_key: "x" };
    const tgt: JsonValue = { other_key: "x", cart_one: "a", cart_few: "b", cart_extra: "c" };
    expect(pruneTarget(src, tgt)).toEqual([["cart_one"], ["cart_few"], ["cart_extra"]]);
  });

  test("a non-category suffix is not treated as a plural form", () => {
    const src: JsonValue = { cart_one: "a", cart_other: "b" };
    const tgt: JsonValue = { cart_one: "a", cart_other: "b", cart_title: "c" };
    expect(pruneTarget(src, tgt)).toEqual([["cart_title"]]);
  });

  test("keeps target-only CLDR categories inside a nested plural map (Rails / Ruby i18n)", () => {
    const src: JsonValue = { en: { inbox: { one: "1 message", other: "%{count} messages" }, title: "T" } };
    const tgt: JsonValue = { en: { inbox: { zero: "z", one: "o", two: "t", few: "f", many: "m", other: "x" }, title: "T" } };
    expect(pruneTarget(src, tgt)).toEqual([]);
  });

  test("a nested plural map still prunes non-category keys", () => {
    const src: JsonValue = { inbox: { one: "a", other: "b" } };
    const tgt: JsonValue = { inbox: { one: "a", few: "c", other: "b", stale: "s" } };
    expect(pruneTarget(src, tgt)).toEqual([["inbox", "stale"]]);
  });

  test("a map that merely contains a category key is not treated as a plural map", () => {
    const src: JsonValue = { menu: { one: "First", label: "Menu" } };
    const tgt: JsonValue = { menu: { one: "x", label: "y", few: "z" } };
    expect(pruneTarget(src, tgt)).toEqual([["menu", "few"]]);
  });

  test("keeps i18next v3 plural forms (stem_<n>, stem_plural) while the source has the stem", () => {
    const src: JsonValue = { item: "item", item_plural: "items" };
    const tgt: JsonValue = { item_0: "a", item_1: "b", item_2: "c", item_3: "d", item_4: "e", item_5: "f" };
    expect(pruneTarget(src, tgt)).toEqual([]);
    const src2: JsonValue = { item_plural: "items" };
    const tgt2: JsonValue = { item: "x", item_plural: "y", item_0: "z" };
    expect(pruneTarget(src2, tgt2)).toEqual([["item"]]);
  });

  test("v3 numeric forms are pruned when the stem is gone", () => {
    const src: JsonValue = { other: "x" };
    const tgt: JsonValue = { other: "x", item_0: "a", item_plural: "b" };
    expect(pruneTarget(src, tgt)).toEqual([["item_0"], ["item_plural"]]);
  });

  test("keeps non-string values whose key exists in source", () => {
    const src: JsonValue = { n: 1, b: true };
    const tgt: JsonValue = { n: 2, b: false, x: 3 };
    expect(pruneTarget(src, tgt)).toEqual([["x"]]);
    expect(tgt).toEqual({ n: 2, b: false });
  });
});
