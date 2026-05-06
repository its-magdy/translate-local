import { describe, test, expect } from "bun:test";
import { diffForSync, makeEmptyTargetLike } from "../sync";
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
