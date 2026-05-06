import { describe, test, expect } from "bun:test";
import { walkLeaves, getAtPath, type JsonValue } from "../walk";

function collect(root: JsonValue) {
  return [...walkLeaves(root)].map((l) => ({ path: l.path, value: l.value }));
}

describe("walkLeaves", () => {
  test("flat object", () => {
    const obj = { a: "1", b: "2", c: "3" };
    expect(collect(obj)).toEqual([
      { path: ["a"], value: "1" },
      { path: ["b"], value: "2" },
      { path: ["c"], value: "3" },
    ]);
  });

  test("nested object preserves source key order", () => {
    const obj = { auth: { login: "Login", signup: "Sign up" }, common: { ok: "OK" } };
    const leaves = collect(obj);
    expect(leaves.map((l) => l.path.join("."))).toEqual(["auth.login", "auth.signup", "common.ok"]);
  });

  test("arrays of strings yield indexed leaves", () => {
    const obj = { items: ["one", "two", "three"] };
    expect(collect(obj)).toEqual([
      { path: ["items", 0], value: "one" },
      { path: ["items", 1], value: "two" },
      { path: ["items", 2], value: "three" },
    ]);
  });

  test("mixed types: only strings are yielded; numbers/booleans/null preserved", () => {
    const obj = { name: "alice", age: 30, active: true, deleted: null, tags: ["x"] };
    expect(collect(obj)).toEqual([
      { path: ["name"], value: "alice" },
      { path: ["tags", 0], value: "x" },
    ]);
  });

  test("empty object yields no leaves", () => {
    expect(collect({})).toEqual([]);
  });

  test("empty array yields no leaves", () => {
    expect(collect({ items: [] })).toEqual([]);
  });

  test("top-level non-object yields no leaves", () => {
    expect(collect("just a string" as unknown as JsonValue)).toEqual([]);
    expect(collect(42 as unknown as JsonValue)).toEqual([]);
    expect(collect(null as unknown as JsonValue)).toEqual([]);
  });

  test("setter mutates the original tree", () => {
    const obj = { greeting: "hello", nested: { count: "two" } };
    for (const leaf of walkLeaves(obj)) {
      leaf.set(leaf.value.toUpperCase());
    }
    expect(obj).toEqual({ greeting: "HELLO", nested: { count: "TWO" } });
  });

  test("setter mutates array elements at the right index", () => {
    const obj = { items: ["a", "b", "c"] };
    for (const leaf of walkLeaves(obj)) {
      if (leaf.value === "b") leaf.set("B");
    }
    expect(obj).toEqual({ items: ["a", "B", "c"] });
  });

  test("deep nesting up to 64 levels works", () => {
    let obj: JsonValue = "deep";
    for (let i = 0; i < 60; i++) {
      obj = { nested: obj };
    }
    expect(collect(obj as JsonValue)).toHaveLength(1);
  });

  test("nesting beyond 64 levels throws", () => {
    let obj: JsonValue = "deep";
    for (let i = 0; i < 70; i++) {
      obj = { nested: obj };
    }
    expect(() => collect(obj)).toThrow(/exceeds maximum depth/);
  });
});

describe("getAtPath", () => {
  test("retrieves nested value", () => {
    const obj = { a: { b: { c: "found" } } };
    expect(getAtPath(obj, ["a", "b", "c"])).toBe("found");
  });

  test("array indexing", () => {
    const obj = { items: ["zero", "one", "two"] };
    expect(getAtPath(obj, ["items", 1])).toBe("one");
  });

  test("missing key returns undefined", () => {
    expect(getAtPath({ a: 1 }, ["b"])).toBeUndefined();
    expect(getAtPath({ a: { b: 1 } }, ["a", "x"])).toBeUndefined();
  });

  test("traversing through a scalar returns undefined", () => {
    expect(getAtPath({ a: "scalar" }, ["a", "b"])).toBeUndefined();
  });

  test("empty path returns the root", () => {
    expect(getAtPath({ a: 1 }, [])).toEqual({ a: 1 });
  });
});
