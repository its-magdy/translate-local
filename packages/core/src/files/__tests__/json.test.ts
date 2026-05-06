import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readJson, writeJson, serializeJson, detectIndent, detectEol, atomicWriteFile } from "../json";

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

describe("readJson", () => {
  test("reads and parses", () => {
    const p = join(dir, "in.json");
    writeFileSync(p, '{\n  "hello": "world"\n}\n');
    const { data, meta } = readJson(p);
    expect(data).toEqual({ hello: "world" });
    expect(meta.indent).toBe("  ");
    expect(meta.trailingNewline).toBe(true);
    expect(meta.eol).toBe("\n");
    expect(meta.hadBOM).toBe(false);
  });

  test("strips UTF-8 BOM", () => {
    const p = join(dir, "bom.json");
    writeFileSync(p, "﻿" + '{"a":1}');
    const { data, meta } = readJson(p);
    expect(data).toEqual({ a: 1 });
    expect(meta.hadBOM).toBe(true);
  });

  test("CRLF preserved in meta", () => {
    const p = join(dir, "crlf.json");
    writeFileSync(p, '{\r\n  "a": 1\r\n}\r\n');
    const { meta } = readJson(p);
    expect(meta.eol).toBe("\r\n");
  });

  test("absent trailing newline reflected in meta", () => {
    const p = join(dir, "no-eol.json");
    writeFileSync(p, '{"a":1}');
    const { meta } = readJson(p);
    expect(meta.trailingNewline).toBe(false);
  });
});

describe("serializeJson + writeJson round-trip", () => {
  test("byte-identical when nothing changes (LF, 2-space, trailing newline)", () => {
    const p = join(dir, "in.json");
    const original = '{\n  "hello": "world",\n  "items": [\n    "a",\n    "b"\n  ]\n}\n';
    writeFileSync(p, original);
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("4-space indent preserved", () => {
    const p = join(dir, "in.json");
    const original = '{\n    "a": 1,\n    "b": 2\n}\n';
    writeFileSync(p, original);
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("tab indent preserved", () => {
    const p = join(dir, "in.json");
    const original = '{\n\t"a": 1\n}\n';
    writeFileSync(p, original);
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("CRLF preserved on write", () => {
    const p = join(dir, "in.json");
    const original = '{\r\n  "a": 1\r\n}\r\n';
    writeFileSync(p, original);
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("no-trailing-newline preserved", () => {
    const p = join(dir, "in.json");
    const original = '{\n  "a": 1\n}';
    writeFileSync(p, original);
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("BOM is stripped, never written back", () => {
    const p = join(dir, "in.json");
    writeFileSync(p, "﻿" + '{"a":1}');
    const { data, meta } = readJson(p);
    const out = join(dir, "out.json");
    writeJson(out, data, meta);
    expect(readFileSync(out, "utf8").startsWith("﻿")).toBe(false);
  });
});

describe("atomicWriteFile", () => {
  test("writes file in place via rename", () => {
    const p = join(dir, "x.json");
    atomicWriteFile(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
  });

  test("does not leave .tmp-<pid> after success", () => {
    const p = join(dir, "x.json");
    atomicWriteFile(p, "hello");
    const tmp = join(dir, `.x.json.tmp-${process.pid}`);
    expect(existsSync(tmp)).toBe(false);
  });

  test("does not corrupt existing file on rename failure", () => {
    // Write existing file
    const p = join(dir, "x.json");
    writeFileSync(p, "original");
    // Try to write to a non-existent directory — error caught; original intact
    const bad = join(dir, "missing", "nested", "x.json");
    expect(() => atomicWriteFile(bad, "new")).toThrow();
    expect(readFileSync(p, "utf8")).toBe("original");
  });
});
