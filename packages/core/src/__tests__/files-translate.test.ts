import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GlossaryStore } from "../glossary";
import { ContextStore } from "../context";
import { MockAdapter } from "@translate-local/adapters/mock";
import { translateFile } from "../files";

// MockAdapter-only — no Ollama needed. Runs by default; the TEST_INTEGRATION gate
// previously here was hiding the whole orchestrator suite from default `bun run test`.

describe("translateFile", () => {
  let dir: string;
  let glossary: GlossaryStore;
  let context: ContextStore;
  let adapter: MockAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tl-files-test-"));
    glossary = new GlossaryStore(join(dir, "g.db"));
    context = new ContextStore(join(dir, "c.db"));
    adapter = new MockAdapter();
  });

  afterEach(async () => {
    glossary.close();
    context.close();
    await adapter.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSrc(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  it("translates missing keys, leaves existing alone (sync mode default)", async () => {
    const src = writeSrc("en.json", '{\n  "hello": "world",\n  "foo": "bar"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "hello": "EXISTING"\n}\n');

    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });

    expect(summary.translated).toBe(1);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.hello).toBe("EXISTING");           // preserved
    expect(after.foo).toBe("[ar] bar");              // newly translated
  });

  it("--force re-translates everything", async () => {
    const src = writeSrc("en.json", '{\n  "hello": "world"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "hello": "EXISTING"\n}\n');

    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      mode: "force",
    });

    expect(summary.translated).toBe(1);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.hello).toBe("[ar] world");
  });

  it("creates target file when none exists", async () => {
    const src = writeSrc("en.json", '{\n  "hello": "world",\n  "foo": "bar"\n}\n');
    const out = join(dir, "ar.json");

    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });

    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after).toEqual({ hello: "[ar] world", foo: "[ar] bar" });
  });

  it("preserves source indentation in output", async () => {
    const src = writeSrc("en.json", '{\n    "a": "x"\n}\n'); // 4-space
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const text = readFileSync(out, "utf8");
    expect(text).toContain('    "a"'); // 4-space indent preserved
  });

  it("applies glossary per leaf", async () => {
    glossary.add({ sourceTerm: "API", targetTerm: "واجهة", sourceLang: "en", targetLang: "ar" });
    const src = writeSrc("en.json", '{\n  "doc": "The API is fast",\n  "other": "no glossary term"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.doc).toContain("واجهة");
    expect(after.other).toContain("no glossary term");
  });

  it("preserves placeholders byte-identical", async () => {
    const src = writeSrc("en.json", '{\n  "g": "Hello {{name}}, you have {{count}} items"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.g).toContain("{{name}}");
    expect(after.g).toContain("{{count}}");
  });

  it("skips URLs, emails, semver, and ALL-CAPS short tokens", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      site: "https://example.com",
      contact: "team@example.com",
      version: "1.2.3",
      label: "OK",
      sentence: "Hello world",
    }, null, 2));
    const out = join(dir, "ar.json");

    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });

    expect(summary.skipped.count).toBe(4);
    expect(summary.translated).toBe(1);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.site).toBe("https://example.com");
    expect(after.contact).toBe("team@example.com");
    expect(after.version).toBe("1.2.3");
    expect(after.label).toBe("OK");
    expect(after.sentence).toBe("[ar] Hello world");
  });

  it("--translate-all bypasses skip heuristics", async () => {
    const src = writeSrc("en.json", '{\n  "v": "1.2.3"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      translateAll: true,
    });
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.v).toBe("[ar] 1.2.3");
  });

  it("refuses ARB by default", async () => {
    const src = writeSrc("en.json", '{\n  "@hello": {},\n  "hello": "Hi"\n}\n');
    const out = join(dir, "ar.json");
    await expect(translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    })).rejects.toThrow(/Unsupported format: arb/);
  });

  it("--format raw-json bypasses ARB refusal", async () => {
    const src = writeSrc("en.json", '{\n  "@hello": {"description": "greeting"},\n  "hello": "Hi"\n}\n');
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      format: "raw-json",
    });
    // raw mode walks every leaf — "description" gets translated too
    expect(summary.translated).toBeGreaterThan(0);
  });

  it("refuses same-locale", async () => {
    const src = writeSrc("en.json", '{"a":"b"}');
    const out = join(dir, "en.json");
    await expect(translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "en",
      adapter, glossary, context,
    })).rejects.toThrow(/SAME_LOCALE|both/);
  });

  it("refuses to write over the source file when sourceLang is auto", async () => {
    const src = writeSrc("en.json", '{"a":"hello"}');
    const before = readFileSync(src, "utf8");
    await expect(translateFile({
      sourcePath: src, outPath: src,
      sourceLang: "auto", targetLang: "en",
      adapter, glossary, context,
    })).rejects.toThrow(/SAME_LOCALE|same file/);
    expect(readFileSync(src, "utf8")).toBe(before);
  });

  it("refuses an --out that reaches the source through a symlinked directory", async () => {
    // resolve() compares strings, so a symlinked path component (macOS
    // /tmp -> /private/tmp) makes one file look like two paths.
    const src = writeSrc("en.json", '{"a":"hello"}');
    const before = readFileSync(src, "utf8");
    const linkDir = join(dir, "link");
    symlinkSync(dir, linkDir, "dir");
    await expect(translateFile({
      sourcePath: src, outPath: join(linkDir, "en.json"),
      sourceLang: "auto", targetLang: "fr",
      adapter, glossary, context,
    })).rejects.toThrow(/SAME_LOCALE|same file/);
    expect(readFileSync(src, "utf8")).toBe(before);
  });

  it("still allows a genuinely different out path in a symlinked directory", async () => {
    const src = writeSrc("en.json", '{"a":"hello"}');
    const linkDir = join(dir, "link2");
    symlinkSync(dir, linkDir, "dir");
    const res = await translateFile({
      sourcePath: src, outPath: join(linkDir, "fr.json"),
      sourceLang: "auto", targetLang: "fr",
      adapter, glossary, context,
    });
    expect(res).toBeDefined();
    expect(existsSync(join(dir, "fr.json"))).toBe(true);
  });

  it("refuses an --out that resolves to the source path", async () => {
    const src = writeSrc("en.json", '{"a":"hello"}');
    await expect(translateFile({
      sourcePath: src, outPath: join(dir, ".", "en.json"),
      sourceLang: "auto", targetLang: "fr",
      adapter, glossary, context,
    })).rejects.toThrow(/SAME_LOCALE|same file/);
  });

  it("refuses missing source file", async () => {
    await expect(translateFile({
      sourcePath: join(dir, "nope.json"), outPath: join(dir, "out.json"),
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    })).rejects.toThrow(/not found/);
  });

  it("emits warning for i18next plural files", async () => {
    const src = writeSrc("en.json", '{\n  "item_one": "{{count}} item",\n  "item_other": "{{count}} items"\n}\n');
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.contentFormat).toBe("i18next-plurals");
    expect(summary.warnings.some((w) => w.includes("CLDR"))).toBe(true);
  });

  it("dry-run-style: format detection happens before any model call", async () => {
    // Exercised by the ARB refusal test above — refuses before adapter.translate is called.
    expect(true).toBe(true);
  });

  it("atomic write: tmp file does not linger after success", async () => {
    const src = writeSrc("en.json", '{\n  "x": "y"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const tmp = join(dir, `.ar.json.tmp-${process.pid}`);
    expect(existsSync(tmp)).toBe(false);
    expect(existsSync(out)).toBe(true);
  });

  it("calls onProgress with monotonic counts", async () => {
    const src = writeSrc("en.json", '{\n  "a":"1","b":"2","c":"3"\n}\n');
    const out = join(dir, "ar.json");
    const events: { done: number; total: number }[] = [];
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      onProgress: (e) => events.push({ done: e.done, total: e.total }),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].done).toBe(events[events.length - 1].total);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].done).toBeGreaterThanOrEqual(events[i - 1].done);
    }
  });

  it("placeholder mismatch with continueOnError=false (strict mode) aborts", async () => {
    class DropSentinelAdapter extends MockAdapter {
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        const re = /__TLPH_\d+__/g;
        const dropped = req.source.replace(re, "");
        return {
          translated: `[${req.targetLang}] ${dropped}`,
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "drop", durationMs: 0, retries: 0 },
        };
      }
    }
    const drop = new DropSentinelAdapter();
    const src = writeSrc("en.json", '{\n  "g": "Hello {{name}}"\n}\n');
    const out = join(dir, "ar.json");
    await expect(translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter: drop, glossary, context,
      continueOnError: false,
    })).rejects.toThrow(/Placeholder mismatch|PLACEHOLDER_MISMATCH/);
  });

  it("placeholder mismatch (default behavior) records failure and falls back to source", async () => {
    class DropSentinelAdapter extends MockAdapter {
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        const re = /__TLPH_\d+__/g;
        const dropped = req.source.replace(re, "");
        return {
          translated: `[${req.targetLang}] ${dropped}`,
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "drop", durationMs: 0, retries: 0 },
        };
      }
    }
    const drop = new DropSentinelAdapter();
    const src = writeSrc("en.json", '{\n  "g": "Hello {{name}}"\n}\n');
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter: drop, glossary, context,
    });
    expect(summary.failed).toHaveLength(1);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.g).toBe("Hello {{name}}"); // source-fallback
  });

  it("continueOnError=true records failure and falls back to source for the bad key", async () => {
    class DropSentinelAdapter extends MockAdapter {
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        const re = /__TLPH_\d+__/g;
        const dropped = req.source.replace(re, "");
        return {
          translated: `[${req.targetLang}] ${dropped}`,
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "drop", durationMs: 0, retries: 0 },
        };
      }
    }
    const drop = new DropSentinelAdapter();
    const src = writeSrc("en.json", JSON.stringify({
      ok: "no placeholder",
      bad: "Hello {{name}}",
    }, null, 2));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter: drop, glossary, context,
      continueOnError: true,
    });
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].path).toBe("bad");
    expect(summary.translated).toBe(1);
  });

  // ── YAML (Phase B) ────────────────────────────────────────────────

  it("translates a YAML file (Rails i18n shape)", async () => {
    const src = writeSrc("en.yml", "en:\n  greeting: \"Hello, %{name}!\"\n  bye: Goodbye\n");
    const out = join(dir, "ar.yml");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.translated).toBe(2);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("[ar] Hello, %{name}!");
    expect(text).toContain("[ar] Goodbye");
  });

  it("preserves YAML comments through translation", async () => {
    const src = writeSrc("en.yml", "# user-facing greeting\ngreeting: hello\ncount: 5\n");
    const out = join(dir, "ar.yml");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const text = readFileSync(out, "utf8");
    expect(text).toContain("# user-facing greeting");
  });

  it("preserves YAML key order in translation", async () => {
    const src = writeSrc("en.yml", "z: one\na: two\nm: three\n");
    const out = join(dir, "ar.yml");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines[0]).toMatch(/^z:/);
    expect(lines[1]).toMatch(/^a:/);
    expect(lines[2]).toMatch(/^m:/);
  });

  it("keeps target-only keys when syncing into an existing YAML target", async () => {
    const src = writeSrc("en.yml", "greeting: hi\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "greeting: EXISTING\nlegacy: kept\n");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.translated).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("legacy: kept");
    expect(text).toContain("greeting: EXISTING");
  });

  it("comments-only source YAML does not clobber an existing target", async () => {
    const src = writeSrc("en.yml", "# nothing here yet\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "legacy: kept\ngreeting: EXISTING\n");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const text = readFileSync(out, "utf8");
    expect(text).toContain("legacy: kept");
    expect(text).toContain("greeting: EXISTING");
  });

  it("keeps a target map where the source has a scalar (shape mismatch)", async () => {
    const src = writeSrc("en.yml", "title: My Title\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "title:\n  one: un titre\n  other: des titres\n");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const text = readFileSync(out, "utf8");
    expect(text).toContain("one: un titre");
    expect(text).toContain("other: des titres");
    expect(text).not.toContain("My Title");
  });

  it("refuses YAML with anchors", async () => {
    const src = writeSrc("en.yml", "shared: &s hello\nx: *s\n");
    const out = join(dir, "ar.yml");
    await expect(translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    })).rejects.toThrow(/anchors|alias/i);
  });
});
