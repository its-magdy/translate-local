import { describe, test, expect } from "bun:test";
import { yamlFormat } from "../yaml";

describe("yamlFormat.read", () => {
  test("parses simple YAML", () => {
    expect(yamlFormat.read("hello: world\nfoo: bar\n")).toEqual({ hello: "world", foo: "bar" });
  });

  test("nested structure", () => {
    expect(yamlFormat.read("auth:\n  login: Login\n  signup: Sign up\n")).toEqual({ auth: { login: "Login", signup: "Sign up" } });
  });

  test("Rails i18n shape with %{name}", () => {
    const data = yamlFormat.read("en:\n  greeting: \"Hello, %{name}!\"\n  notifications:\n    one: \"1 message\"\n    other: \"%{count} messages\"\n");
    expect((data as never as { en: { greeting: string } }).en.greeting).toBe("Hello, %{name}!");
  });

  test("parses the source catalog's data the same way", () => {
    expect(yamlFormat.open("auth:\n  login: Login\n").data).toEqual({ auth: { login: "Login" } });
  });
});

describe("yamlFormat refusals", () => {
  test("refuses anchors", () => {
    expect(() => yamlFormat.open("shared: &s hello\nx: *s\n")).toThrow(/anchors|alias/i);
  });

  test("refuses YAML 1.1 directive", () => {
    expect(() => yamlFormat.open("%YAML 1.1\n---\nk: v\n")).toThrow(/YAML 1\.1/);
  });

  test("refuses multi-document streams", () => {
    expect(() => yamlFormat.open("k: v\n---\nk2: v2\n")).toThrow(/multiple documents|Multi-document/i);
  });
});

describe("yamlFormat round-trip", () => {
  test("byte-identical when no leaf changes", () => {
    const original = "hello: world\nfoo: bar\n";
    const r = yamlFormat.open(original);
    const written = r.retarget({ existing: r.data }).serialize();
    expect(written).toBe(original);
  });

  test("preserves comments above keys", () => {
    const original = "# greeting in user's language\nhello: world\n# unread count\ncount: 5\n";
    const r = yamlFormat.open(original);
    const written = r.retarget({ existing: r.data }).serialize();
    expect(written).toContain("# greeting in user's language");
    expect(written).toContain("# unread count");
  });

  test("preserves key order when modifying values", () => {
    const original = "z_first: 1\na_second: 2\nm_third: 3\n";
    const r = yamlFormat.open(original);
    // Mutate one value
    const data = r.data as { [k: string]: number };
    const written = r.retarget({ existing: { z_first: 1, a_second: 2, m_third: 3 } as never }).serialize();
    const lines = written.trim().split("\n");
    expect(lines[0]).toMatch(/^z_first:/);
    expect(lines[1]).toMatch(/^a_second:/);
    expect(lines[2]).toMatch(/^m_third:/);
  });

  test("translated string values are written back", () => {
    const original = "greeting: hello\n";
    const r = yamlFormat.open(original);
    const data = { greeting: "مرحبا" };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(written).toContain("مرحبا");
  });

  test("keys present only in data survive the write (existing-target sync)", () => {
    const original = "# top comment\ngreeting: hi\nnested:\n  a: one\n";
    const r = yamlFormat.open(original);
    const data = {
      greeting: "marhaba",
      nested: { a: "wahid", b: "extra-nested" },
      legacy: "kept",
    };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(written).toContain("legacy: kept");
    expect(written).toContain("b: extra-nested");
    expect(written).toContain("# top comment");
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("array elements beyond the doc's length survive the write", () => {
    const original = "items:\n  - one\n  - two\n";
    const r = yamlFormat.open(original);
    const data = { items: ["uno", "dos", "tres"] };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("comments-only source doc (contents === null): data survives the write", () => {
    const r = yamlFormat.open("# nothing here yet\n");
    const data = { legacy: "kept", nested: { a: "one" } };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(written).toContain("# nothing here yet");
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("shape mismatch: source scalar vs data map is replaced, not dropped", () => {
    const r = yamlFormat.open("title: My Title\ngreeting: hi\n");
    const data = { title: { one: "un titre", other: "des titres" }, greeting: "marhaba" };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("shape mismatch: source map vs data string is replaced, not dropped", () => {
    const r = yamlFormat.open("title:\n  one: a\n  other: b\n");
    const data = { title: "flattened" };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("empty `key:` (null value node) accepts a string", () => {
    const r = yamlFormat.open("greeting:\n");
    const data = { greeting: "marhaba" };
    const written = r.retarget({ existing: data as never }).serialize();
    expect(yamlFormat.read(written)).toEqual(data as never);
  });

  test("preserves block scalar style |", () => {
    const original = "longtext: |\n  line one\n  line two\n";
    const r = yamlFormat.open(original);
    // Translate the block scalar value
    const written = r.retarget({ existing: { longtext: "line one\nline two\n" } as never }).serialize();
    expect(written).toContain("longtext: |");
  });

  test("block scalar chomping survives a value with no trailing newline", () => {
    // Translation returns text without the trailing newline; `|` must not
    // silently become `|-`.
    const r = yamlFormat.open("longtext: |\n  line one\n  line two\n");
    const written = r.retarget({ existing: { longtext: "سطر واحد\nسطر اثنان" } as never }).serialize();
    expect(written).toContain("longtext: |\n");
    expect(written).not.toContain("|-");
  });

  test("block scalar keep indicator |+ survives", () => {
    const r = yamlFormat.open("longtext: |+\n  line one\n\n");
    const written = r.retarget({ existing: { longtext: "سطر واحد" } as never }).serialize();
    expect(written).toContain("|+");
  });

  test("strip indicator |- is not turned into |", () => {
    const r = yamlFormat.open("longtext: |-\n  line one\n");
    const written = r.retarget({ existing: { longtext: "سطر واحد" } as never }).serialize();
    expect(written).toContain("|-");
  });

  test("CRLF preserved", () => {
    const original = "a: 1\r\nb: 2\r\n";
    const r = yamlFormat.open(original);
    expect(r.retarget({ existing: r.data }).serialize()).toBe(original);
  });

  test("4-space indent preserved", () => {
    const original = "outer:\n    inner: x\n";
    const r = yamlFormat.open(original);
    const written = r.retarget({ existing: r.data }).serialize();
    expect(written).toBe(original);
  });

  test("missing trailing newline preserved", () => {
    const r = yamlFormat.open("k: v");
    expect(r.retarget({ existing: { k: "w" } }).serialize()).toBe("k: w");
  });
});
