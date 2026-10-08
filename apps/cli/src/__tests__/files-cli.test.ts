import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "../../src/index.ts");
// tl resolves ~/.config/tl from homedir(), so every spawn gets a throwaway HOME
// (USERPROFILE on Windows) —
// otherwise the suite reads and migrates the developer's real databases.
const TEST_HOME = mkdtempSync(join(tmpdir(), "tl-home-"));

function run(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", HOME: TEST_HOME, USERPROFILE: TEST_HOME, ...env },
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

  it("emits no carriage-return progress when stderr is not a TTY", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "one apple",\n  "b": "two pears",\n  "c": "three plums"\n}\n');

    const r = run(
      ["translate", "--file", src, "--to", "ar"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("\r");
    expect(r.stderr).not.toContain("Translated ");
    expect(r.stdout).toContain("Translated: 3 / 3");
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

  it("renames a Rails root locale key with --from auto, using the filename locale", () => {
    const src = join(dir, "en.yml");
    writeFileSync(src, "en:\n  hello: Hello\n");
    const out = join(dir, "fr.yml");

    const r = run(
      ["translate", "--file", src, "--from", "auto", "--to", "fr"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Root locale key: en -> fr");
    expect(readFileSync(out, "utf8")).toStartWith("fr:\n");
  });

  it("--dry-run reports the root locale rename without writing", () => {
    const src = join(dir, "en.yml");
    writeFileSync(src, "en:\n  hello: Hello\n");

    const r = run(
      ["translate", "--file", src, "--from", "en", "--to", "fr", "--dry-run"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[dry-run] Root locale key: en -> fr");
    expect(existsSync(join(dir, "fr.yml"))).toBe(false);
  });

  it("--json includes rootLocaleKey", () => {
    const src = join(dir, "en.yml");
    writeFileSync(src, "en:\n  hello: Hello\n");

    const r = run(
      ["translate", "--file", src, "--from", "en", "--to", "fr", "--json"],
      { TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).rootLocaleKey).toEqual({ from: "en", to: "fr" });
  });

  it("--help mentions --file", () => {
    const r = run(["translate", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--file");
    expect(r.stdout).toContain("--out");
    expect(r.stdout).toContain("--force");
    expect(r.stdout).toContain("--dry-run");
    expect(r.stdout).toContain("--prune");
  });

  // HOME is pointed at the temp dir so default db paths never touch the real ~/.config/tl.
  const env = () => ({ TL_ADAPTER: "mock", XDG_CONFIG_HOME: dir, HOME: dir, USERPROFILE: dir });
  // The temp dir has no .git ancestor, so .tl/locks/ falls back to the target's directory.
  const lockFile = (target = "ar.json") => join(dir, ".tl", "locks", `${target}.lock`);

  it("--out into another directory of a git project records the lock at the project root", () => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "i18n"));
    mkdirSync(join(dir, "src"));
    const src = join(dir, "src", "en.json");
    writeFileSync(src, '{\n  "a": "Hello"\n}\n');
    const out = join(dir, "i18n", "ar.json");

    expect(run(["translate", "--file", src, "--to", "ar", "--out", out], env()).exitCode).toBe(0);
    expect(readdirSync(join(dir, "i18n"))).toEqual(["ar.json"]);
    expect(Object.keys(JSON.parse(readFileSync(lockFile("i18n/ar.json"), "utf8")).checksums)).toEqual(["/a"]);

    writeFileSync(src, '{\n  "a": "Hello there"\n}\n');
    const r = run(["translate", "--file", src, "--to", "ar", "--out", out], env());
    expect(r.stdout).toContain("Source changed: 1");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "[ar] Hello there" });
  });

  it("--prune removes target-only keys and prints a pruned count", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "a": "TA",\n  "stale": "S"\n}\n');

    const r = run(["translate", "--file", src, "--to", "ar", "--prune"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Pruned: 1");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "TA" });
  });

  it("--prune refuses a large removal unless --allow-large-prune is passed", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    const before = '{\n  "a": "TA",\n  "x": "X",\n  "y": "Y"\n}\n';
    writeFileSync(out, before);

    const refused = run(["translate", "--file", src, "--to", "ar", "--prune"], env());
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("would remove 2 of 3");
    expect(refused.stderr).toContain("--allow-large-prune");
    expect(readFileSync(out, "utf8")).toBe(before);

    const ok = run(["translate", "--file", src, "--to", "ar", "--prune", "--allow-large-prune"], env());
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("Pruned: 2");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "TA" });
  });

  it("--dry-run --prune lists what would be pruned and writes nothing", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    const before = '{\n  "a": "TA",\n  "stale": "S"\n}\n';
    writeFileSync(out, before);

    const r = run(["translate", "--file", src, "--to", "ar", "--prune", "--dry-run"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[dry-run] Would prune: 1");
    expect(r.stdout).toContain("stale");
    expect(readFileSync(out, "utf8")).toBe(before);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("re-translates a key whose source changed and reports it", () => {
    const src = join(dir, "en.json");
    writeFileSync(src, '{\n  "a": "Hello",\n  "b": "World"\n}\n');
    const out = join(dir, "ar.json");
    expect(run(["translate", "--file", src, "--to", "ar"], env()).exitCode).toBe(0);
    expect(existsSync(lockFile())).toBe(true);

    writeFileSync(src, '{\n  "a": "Hello there",\n  "b": "World"\n}\n');
    const dry = run(["translate", "--file", src, "--to", "ar", "--dry-run"], env());
    expect(dry.stdout).toContain("[dry-run] Would translate: 1");
    expect(dry.stdout).toContain("[dry-run] Source changed: 1");

    const r = run(["translate", "--file", src, "--to", "ar"], env());
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Translated: 1 / 1");
    expect(r.stdout).toContain("Source changed: 1");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "[ar] Hello there", b: "[ar] World" });
  });
});
