import { describe, it, expect } from "bun:test";
import { findDuplicateKeys } from "../files/json";

describe("findDuplicateKeys", () => {
  it("returns nothing for unique keys", () => {
    expect(findDuplicateKeys('{"a":1,"b":{"a":2}}')).toEqual([]);
  });

  it("finds top-level duplicates with line numbers", () => {
    expect(findDuplicateKeys('{\n"a": "x",\n"b": "y",\n"a": "z"\n}')).toEqual([{ path: "a", line: 4 }]);
  });

  it("finds nested duplicates and keys inside arrays of objects", () => {
    const text = '{"o":{"k":1,"k":2},"arr":[{"x":1},{"y":1,"y":2}]}';
    expect(findDuplicateKeys(text)).toEqual([
      { path: "o.k", line: 1 },
      { path: "arr[1].y", line: 1 },
    ]);
  });

  it("ignores key-like text and escaped quotes inside strings", () => {
    const text = '{"a":"he said \\"a\\": 1, \\"a\\": 2","b":"\\\\","c":["a","a"]}';
    expect(findDuplicateKeys(text)).toEqual([]);
  });

  it("treats escaped-equivalent keys as the same key", () => {
    expect(findDuplicateKeys('{"a":1,"\\u0061":2}')).toEqual([{ path: "a", line: 1 }]);
  });

  it("handles empty containers and scalars", () => {
    expect(findDuplicateKeys('{"a":{},"b":[],"c":null,"d":-1.5e3,"e":true}')).toEqual([]);
  });
});
