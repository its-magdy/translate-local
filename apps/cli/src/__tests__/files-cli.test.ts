import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "../../src/index.ts");

function run(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

describe("tl translate --file", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tl-files-cli-"));
    configPath = join(dir, "config.jsonc");
    writeFileSync(configPath, JSON.stringify({
      adapter: { backend: "local" },
      glossary: { dbPath: join(dir, "g.db") },
      context: { dbPath: join(dir, "c.db") },
    }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("translates a JSON file to a sibling locale", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "hello": "world",\n  "foo": "bar"\n}\n');
    const out = join(dir, "ar.json");

    const r = run(
      ["translate", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Wrote");
    expect(r.stdout).toContain("Translated:");
    expect(existsSync(out)).toBe(true);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.hello).toBe("[ar] world");
    expect(after.foo).toBe("[ar] bar");
  });

  it("dry-run does not write the output file", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "1"\n}\n');
    const out = join(dir, "ar.json");

    const r = run(
      ["translate", "--file", src, "--to", "ar", "--dry-run"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("dry-run");
    expect(r.stdout).toContain("Would translate");
    expect(existsSync(out)).toBe(false);
  });

  it("--out overrides the inferred path", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{"a":"1"}');
    const out = join(dir, "custom-target.json");

    const r = run(
      ["translate", "--file", src, "--to", "ar", "--out", out],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it("requires --out when locale token cannot be inferred", () => {
    const src = join(dir, "strings.json");
    writeFileSync(src, '{"a":"1"}');

    const r = run(
      ["translate", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Cannot infer output path");
  });

  it("refuses ARB-shaped files", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "@hello": {},\n  "hello": "Hi"\n}\n');

    const r = run(
      ["translate", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("arb");
  });

  it("--format raw-json bypasses ARB refusal", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "@hello": {"description": "greet"},\n  "hello": "Hi"\n}\n');

    const r = run(
      ["translate", "--file", src, "--to", "ar", "--format", "raw-json"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
  });

  it("rejects same-locale", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{"a":"1"}');

    const r = run(
      ["translate", "--file", src, "--from", "en", "--to", "en"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).not.toBe(0);
  });

  it("--json prints a parseable summary", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{"hello":"world","foo":"bar"}');

    const r = run(
      ["translate", "--file", src, "--to", "ar", "--json"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.totalLeaves).toBe(2);
    expect(parsed.translated).toBe(2);
    expect(parsed.contentFormat).toBe("vanilla");
  });

  it("rejects mixing --file and positional text", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{"a":"1"}');

    const r = run(
      ["translate", "hello", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Use only one of");
  });

  it("translates a YAML file", () => {
    const src = join(dir, "en.yml");
    writeFileSync(src, "# greeting\ngreeting: hello\nbye: goodbye\n");
    const out = join(dir, "ar.yml");

    const r = run(
      ["translate", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("[ar] hello");
    expect(text).toContain("# greeting"); // comment preserved
  });

  it("--help mentions --file", () => {
    const r = run(["translate", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--file");
    expect(r.stdout).toContain("--out");
    expect(r.stdout).toContain("--force");
    expect(r.stdout).toContain("--dry-run");
  });
});
