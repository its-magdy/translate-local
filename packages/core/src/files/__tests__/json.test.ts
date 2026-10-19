import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { jsonFormat, detectIndent, detectEol } from "../json";
import { atomicWriteFile } from "../atomic";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tl-json-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("detectIndent", () => {
  test("2-space", () => {
    expect(detectIndent('{\n  "a": 1\n}')).toBe("  ");
  });
  test("4-space", () => {
    expect(detectIndent('{\n    "a": 1\n}')).toBe("    ");
  });
  test("tab", () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toBe("\t");
  });
  test("default to 2-space when no indented lines", () => {
    expect(detectIndent('{"a":1}')).toBe("  ");
  });
});

describe("detectEol", () => {
  test("LF", () => {
    expect(detectEol("a\nb\nc")).toBe("\n");
  });
  test("CRLF", () => {
    expect(detectEol("a\r\nb\r\nc")).toBe("\r\n");
  });
});

describe("jsonFormat.read", () => {
  test("reads and parses", () => {
    expect(jsonFormat.read('{\n  "hello": "world"\n}\n')).toEqual({ hello: "world" });
  });

  test("strips UTF-8 BOM", () => {
    expect(jsonFormat.read("\uFEFF" + '{"a":1}')).toEqual({ a: 1 });
  });

  test("reports duplicate keys in a source catalog", () => {
    expect(jsonFormat.open('{\n"a": "x",\n"a": "y"\n}').duplicateKeys).toEqual([{ path: "a", line: 3 }]);
  });
});

// Writes the source's own data back, as translateFile does with an unchanged target.
const roundTrip = (text: string): string => {
  const catalog = jsonFormat.open(text);
  return catalog.retarget({ existing: catalog.data }).serialize();
};

describe("jsonFormat round-trip", () => {
  test("byte-identical when nothing changes (LF, 2-space, trailing newline)", () => {
    const original = '{\n  "hello": "world",\n  "items": [\n    "a",\n    "b"\n  ]\n}\n';
    expect(roundTrip(original)).toBe(original);
  });

  test("4-space indent preserved", () => {
    const original = '{\n    "a": 1,\n    "b": 2\n}\n';
    expect(roundTrip(original)).toBe(original);
  });

  test("tab indent preserved", () => {
    const original = '{\n\t"a": 1\n}\n';
    expect(roundTrip(original)).toBe(original);
  });

  test("CRLF preserved on write", () => {
    const original = '{\r\n  "a": 1\r\n}\r\n';
    expect(roundTrip(original)).toBe(original);
  });

  test("no-trailing-newline preserved", () => {
    const original = '{\n  "a": 1\n}';
    expect(roundTrip(original)).toBe(original);
  });

  test("BOM is stripped, never written back", () => {
    expect(roundTrip("\uFEFF" + '{"a":1}').startsWith("\uFEFF")).toBe(false);
  });
});

describe("validate-before-rename", () => {
  test("a malformed serialization is caught before replacing the existing target", () => {
    // Simulate a corrupt write by calling atomicWriteFile with non-JSON text and the
    // same validator translateFile uses. The existing target must not be replaced.
    const p = join(dir, "out.json");
    writeFileSync(p, '{"hello":"world"}');
    expect(() =>
      atomicWriteFile(p, "this is not JSON", (tmpPath) => {
        // Same call translateFile makes — jsonFormat.read throws on non-JSON.
        jsonFormat.read(readFileSync(tmpPath, "utf8"));
      }),
    ).toThrow();
    expect(readFileSync(p, "utf8")).toBe('{"hello":"world"}');
  });
});
