import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readYaml, writeYaml } from "../yaml";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tl-yaml-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function w(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

describe("readYaml", () => {
  test("parses simple YAML", () => {
    const p = w("a.yml", "hello: world\nfoo: bar\n");
    const r = readYaml(p);
    expect(r.data).toEqual({ hello: "world", foo: "bar" });
    expect(r.meta.indent).toBe(2);
    expect(r.meta.trailingNewline).toBe(true);
    expect(r.meta.eol).toBe("\n");
  });

  test("nested structure", () => {
    const p = w("a.yml", "auth:\n  login: Login\n  signup: Sign up\n");
    const r = readYaml(p);
    expect(r.data).toEqual({ auth: { login: "Login", signup: "Sign up" } });
  });

  test("Rails i18n shape with %{name}", () => {
    const p = w("en.yml", "en:\n  greeting: \"Hello, %{name}!\"\n  notifications:\n    one: \"1 message\"\n    other: \"%{count} messages\"\n");
    const r = readYaml(p);
    expect((r.data as never as { en: { greeting: string } }).en.greeting).toBe("Hello, %{name}!");
  });

  test("4-space indent detection", () => {
    const p = w("a.yml", "outer:\n    inner: x\n");
    const r = readYaml(p);
    expect(r.meta.indent).toBe(4);
  });

  test("missing trailing newline", () => {
    const p = w("a.yml", "k: v");
    const r = readYaml(p);
    expect(r.meta.trailingNewline).toBe(false);
  });
});

describe("readYaml refusals", () => {
  test("refuses anchors", () => {
    const p = w("a.yml", "shared: &s hello\nx: *s\n");
    expect(() => readYaml(p)).toThrow(/anchors|alias/i);
  });

  test("refuses YAML 1.1 directive", () => {
    const p = w("a.yml", "%YAML 1.1\n---\nk: v\n");
    expect(() => readYaml(p)).toThrow(/YAML 1\.1/);
  });

  test("refuses multi-document streams", () => {
    const p = w("a.yml", "k: v\n---\nk2: v2\n");
    expect(() => readYaml(p)).toThrow(/multiple documents|Multi-document/i);
  });
});

describe("writeYaml round-trip", () => {
  test("byte-identical when no leaf changes", () => {
    const original = "hello: world\nfoo: bar\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, r.data);
    expect(readFileSync(out, "utf8")).toBe(original);
  });

  test("preserves comments above keys", () => {
    const original = "# greeting in user's language\nhello: world\n# unread count\ncount: 5\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, r.data);
    const written = readFileSync(out, "utf8");
    expect(written).toContain("# greeting in user's language");
    expect(written).toContain("# unread count");
  });

  test("preserves key order when modifying values", () => {
    const original = "z_first: 1\na_second: 2\nm_third: 3\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    // Mutate one value
    const data = r.data as { [k: string]: number };
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, { z_first: 1, a_second: 2, m_third: 3 } as never);
    const written = readFileSync(out, "utf8");
    const lines = written.trim().split("\n");
    expect(lines[0]).toMatch(/^z_first:/);
    expect(lines[1]).toMatch(/^a_second:/);
    expect(lines[2]).toMatch(/^m_third:/);
  });

  test("translated string values are written back", () => {
    const original = "greeting: hello\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const data = { greeting: "مرحبا" };
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, data as never);
    const written = readFileSync(out, "utf8");
    expect(written).toContain("مرحبا");
  });

  test("keys present only in data survive the write (existing-target sync)", () => {
    const original = "# top comment\ngreeting: hi\nnested:\n  a: one\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const data = {
      greeting: "marhaba",
      nested: { a: "wahid", b: "extra-nested" },
      legacy: "kept",
    };
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, data as never);
    const written = readFileSync(out, "utf8");
    expect(written).toContain("legacy: kept");
    expect(written).toContain("b: extra-nested");
    expect(written).toContain("# top comment");
    const roundTrip = readYaml(out);
    expect(roundTrip.data).toEqual(data as never);
  });

  test("array elements beyond the doc's length survive the write", () => {
    const original = "items:\n  - one\n  - two\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const data = { items: ["uno", "dos", "tres"] };
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, data as never);
    expect(readYaml(out).data).toEqual(data as never);
  });

  test("preserves block scalar style |", () => {
    const original = "longtext: |\n  line one\n  line two\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    // Translate the block scalar value
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, { longtext: "line one\nline two\n" } as never);
    const written = readFileSync(out, "utf8");
    expect(written).toContain("longtext: |");
  });

  test("CRLF preserved", () => {
    const original = "a: 1\r\nb: 2\r\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    expect(r.meta.eol).toBe("\r\n");
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, r.data);
    expect(readFileSync(out, "utf8")).toContain("\r\n");
  });

  test("4-space indent preserved", () => {
    const original = "outer:\n    inner: x\n";
    const p = w("in.yml", original);
    const r = readYaml(p);
    const out = join(dir, "out.yml");
    writeYaml(out, r.doc, r.meta, r.data);
    expect(readFileSync(out, "utf8")).toContain("    inner");
  });
});
