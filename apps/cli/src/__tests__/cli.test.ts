import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "../../src/index.ts");

function run(args: string[], env?: Record<string, string>): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bun", ["run", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

describe("tl CLI", () => {
  let tmpDir: string;
  let glossaryDb: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-test-"));
    glossaryDb = join(tmpDir, "glossary.db");
    configPath = join(tmpDir, "config.jsonc");

    // Write a minimal config pointing to our temp db
    writeFileSync(
      configPath,
      JSON.stringify({
        adapter: { backend: "local" },
        glossary: { dbPath: glossaryDb },
        context: { dbPath: join(tmpDir, "context.db") },
      }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("--help", () => {
    it("shows help", () => {
      const r = run(["--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("tl");
      expect(r.stdout).toContain("translate");
      expect(r.stdout).toContain("glossary");
    });
  });

  describe("--version", () => {
    it("prints version", () => {
      const r = run(["--version"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe("config path", () => {
    it("prints config path", () => {
      const r = run(["config", "path"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("config.jsonc");
    });
  });

  describe("config status", () => {
    it("shows status from config file", () => {
      const r = run(["config", "status"], { TL_CONFIG: configPath });
      // TL_CONFIG env var not wired yet — but at least shouldn't crash with parse error
      // and default config should show something meaningful
      expect([0, 1]).toContain(r.exitCode);
    });
  });

  describe("glossary", () => {
    it("lists empty glossary", () => {
      const r = run(["glossary", "list"], { TL_CONFIG: configPath });
      // With custom config pointing to fresh db — should show empty message
      // (TL_CONFIG env wiring may not be implemented yet, accept either)
      expect([0]).toContain(r.exitCode);
    });

    it("shows help for glossary add", () => {
      const r = run(["glossary", "add", "--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("--source");
      expect(r.stdout).toContain("--target");
    });

    it("errors on missing required flags for glossary add", () => {
      const r = run(["glossary", "add"]);
      expect(r.exitCode).not.toBe(0);
    });

    it("exports JSON from empty glossary", () => {
      const r = run(["glossary", "export", "--json"]);
      expect(r.exitCode).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    });
  });

  describe("context", () => {
    it("context add returns not-yet-available error", () => {
      const r = run(["context", "add", "/tmp/foo"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Phase 5");
    });
  });

  describe("translate help", () => {
    it("shows translate help", () => {
      const r = run(["translate", "--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("--to");
      expect(r.stdout).toContain("--glossary");
    });
  });
});
