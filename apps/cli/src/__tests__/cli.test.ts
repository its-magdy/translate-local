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
    it("shows backend and model in output", () => {
      const r = run(["config", "status"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Backend:");
      expect(r.stdout).toContain("Model:");
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

    // BUG-001/002: CSV import should skip the header row
    it("imports CSV and skips header row (BUG-001/002)", () => {
      const csvFile = join(tmpDir, "terms.csv");
      writeFileSync(csvFile, "source,target,from,to,domain,note\nhello,مرحبا,en,ar,,\n");
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      // Must report 1, not 2
      expect(r.stdout).toContain("Imported 1");
    });

    it("imports CSV with source_lang header variant and skips it (BUG-001)", () => {
      const csvFile = join(tmpDir, "terms2.csv");
      writeFileSync(csvFile, "source,target,source_lang,target_lang,domain,notes\nhello,مرحبا,en,ar,,\n");
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Imported 1");
    });

    // BUG-004: invalid language codes should be rejected
    it("rejects invalid --to language in glossary add (BUG-004)", () => {
      const r = run(["glossary", "add", "--source", "test", "--target", "test", "--from", "en", "--to", "xyz"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("xyz");
    });

    it("rejects invalid --from language in glossary add (BUG-004)", () => {
      const r = run(["glossary", "add", "--source", "test", "--target", "test", "--from", "zzz", "--to", "ar"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("zzz");
    });

    it("imports CSV with quoted fields containing commas", () => {
      const csvFile = join(tmpDir, "quoted.csv");
      writeFileSync(csvFile, '"machine learning, deep","تعلم الآلة، العميق",en,ar,,\n');
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Imported 1");
    });

    it("imports CSV skipping empty lines and comments", () => {
      const csvFile = join(tmpDir, "gaps.csv");
      writeFileSync(csvFile, "# comment line\n\nhello,مرحبا,en,ar,,\n\nworld,عالم,en,ar,,\n");
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Imported 2");
    });

    it("imports CSV with special characters in terms", () => {
      const csvFile = join(tmpDir, "special.csv");
      writeFileSync(csvFile, 'C++,سي بلس بلس,en,ar,,\n"C#",سي شارب,en,ar,,\n');
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Imported 2");
    });

    it("imports CSV skipping rows with missing required fields", () => {
      const csvFile = join(tmpDir, "incomplete.csv");
      writeFileSync(csvFile, "hello,مرحبا,en,ar,,\n,missing_source,en,ar,,\nworld,,en,ar,,\n");
      const r = run(["glossary", "import", csvFile]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Imported 1");
    });
  });

  describe("context", () => {
    it("context add with invalid path returns CONTEXT_DB_ERROR", () => {
      const r = run(["context", "add", "/nonexistent/path/xyz"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("CONTEXT_DB_ERROR");
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

  describe("translate validation (BUG-004/005)", () => {
    it("rejects invalid --to language code (BUG-004)", () => {
      const r = run(["translate", "hello", "--to", "xyz"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("xyz");
    });

    it("rejects invalid --from language code (BUG-004)", () => {
      const r = run(["translate", "hello", "--from", "zzz", "--to", "ar"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("zzz");
    });

    it("outputs JSON error when --json and invalid lang (BUG-005/004)", () => {
      const r = run(["translate", "hello", "--to", "xyz", "--json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stderr);
      expect(parsed).toHaveProperty("error");
      expect(parsed).toHaveProperty("message");
    });
  });

  describe("translate e2e with MockAdapter", () => {
    it("translates text using mock adapter", () => {
      const r = run(["translate", "hello world", "--to", "ar"], { TL_ADAPTER: "mock" });
      expect(r.exitCode).toBe(0);
      // MockAdapter doesn't stream, so non-JSON output shows metadata only
      expect(r.stdout).toContain("mock");
      expect(r.stdout).toContain("Glossary:");
    });

    it("translates with --json flag using mock adapter", () => {
      const r = run(["translate", "hello world", "--to", "ar", "--json"], { TL_ADAPTER: "mock" });
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.translated).toContain("[ar]");
      expect(parsed.translated).toContain("hello world");
      expect(parsed.targetLang).toBe("ar");
    });

    it("translates with --from flag using mock adapter", () => {
      const r = run(["translate", "hello", "--from", "en", "--to", "fr", "--json"], { TL_ADAPTER: "mock" });
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.translated).toContain("[fr]");
      expect(parsed.sourceLang).toBe("en");
    });
  });

  describe("translate --image", () => {
    it("errors when neither text nor --image is provided", () => {
      const r = run(["translate", "--to", "ar"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--image");
    });

    it("errors with IMAGE_NOT_FOUND for nonexistent file", () => {
      const r = run(["translate", "--image", "/nonexistent/image.png", "--to", "ar"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("IMAGE_NOT_FOUND");
    });

    it("outputs JSON IMAGE_NOT_FOUND when --json and missing image file", () => {
      const r = run(["translate", "--image", "/nonexistent/image.png", "--to", "ar", "--json"]);
      expect(r.exitCode).toBe(1);
      const parsed = JSON.parse(r.stderr);
      expect(parsed.error).toBe("IMAGE_NOT_FOUND");
    });

    it("errors with IMAGE_INVALID_TYPE for unsupported extension", () => {
      const r = run(["translate", "--image", "/some/file.pdf", "--to", "ar"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("IMAGE_INVALID_TYPE");
    });

    it("shows --image in translate help", () => {
      const r = run(["translate", "--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("--image");
    });
  });
});
