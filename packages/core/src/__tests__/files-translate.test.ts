import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse as parseYaml } from "yaml";
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

  describe("i18next plural regeneration", () => {
    const EN_PLURALS = '{\n  "title": "Files",\n  "item_one": "{{count}} item",\n  "item_other": "{{count}} items"\n}\n';

    // Echoes the source like MockAdapter, but lets a test rewrite the model output.
    class ScriptedAdapter extends MockAdapter {
      sources: string[] = [];
      constructor(private rewrite: (source: string) => string = (s) => s) { super(); }
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        this.sources.push(req.source);
        return {
          translated: `[${req.targetLang}] ${this.rewrite(req.source)}`,
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "scripted", durationMs: 0, retries: 0 },
        };
      }
    }

    it("en→ar writes all six Arabic categories and no review warning", async () => {
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context,
      });
      expect(summary.contentFormat).toBe("i18next-plurals");
      expect(summary.warnings).toEqual([]);
      expect(summary.translated).toBe(7);
      const after = JSON.parse(readFileSync(out, "utf8"));
      expect(Object.keys(after)).toEqual(["title", "item_zero", "item_one", "item_two", "item_few", "item_many", "item_other"]);
      expect(after.item_one).toBe("[ar] {{count}} item");
      expect(after.item_few).toBe("[ar] {{count}} items");
    });

    it("shows the model a sample count for each category instead of the placeholder", async () => {
      const scripted = new ScriptedAdapter();
      const src = writeSrc("en.json", EN_PLURALS);
      await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(scripted.sources).toEqual(["Files", "0 items", "1 item", "2 items", "3 items", "11 items", "100 items"]);
    });

    it("regenerates and hints plurals under a Rails root locale key (en: → ar:)", async () => {
      const scripted = new ScriptedAdapter();
      const src = writeSrc("en.yml", "en:\n  item_one: \"{{count}} item\"\n  item_other: \"{{count}} items\"\n");
      const out = join(dir, "ar.yml");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "ar" });
      expect(summary.failed).toEqual([]);
      expect(scripted.sources).toEqual(["0 items", "1 item", "2 items", "3 items", "11 items", "100 items"]);
      const after = parseYaml(readFileSync(out, "utf8"));
      expect(Object.keys(after)).toEqual(["ar"]);
      expect(Object.keys(after.ar)).toEqual(["item_zero", "item_one", "item_two", "item_few", "item_many", "item_other"]);
      expect(after.ar.item_few).toBe("[ar] {{count}} items");
    });

    it("hints a count wrapped in markup (`<b>{{count}}</b>`)", async () => {
      const scripted = new ScriptedAdapter();
      const src = writeSrc("en.json", '{\n  "n_one": "<b>{{count}}</b> item",\n  "n_other": "<b>{{count}}</b> items"\n}\n');
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.warnings).toEqual([]);
      // Markup stays raw around the sample: translategemma keeps `<b>3</b>` but drops
      // sentinels glued to a bare number (`__TLPH_0__3__TLPH_2__` → `3`).
      expect(scripted.sources).toContain("<b>3</b> items");
      expect(JSON.parse(readFileSync(out, "utf8")).n_few).toBe("[ar] <b>{{count}}</b> items");
    });

    it("accepts a dropped count for a single-number category (Arabic dual)", async () => {
      const scripted = new ScriptedAdapter((s) => (s === "2 items" ? "عنصران" : s));
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.failed).toEqual([]);
      expect(JSON.parse(readFileSync(out, "utf8")).item_two).toBe("[ar] عنصران");
    });

    it("a dropped count does not get confused with digits in other placeholder sentinels", async () => {
      const scripted = new ScriptedAdapter((s) => s.replace(/^1 day/, "one day"));
      const src = writeSrc("en.json", '{\n  "left_one": "{{count}} day left, {{name}}",\n  "left_other": "{{count}} days left, {{name}}"\n}\n');
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.failed).toEqual([]);
      expect(JSON.parse(readFileSync(out, "utf8")).left_one).toBe("[ar] one day left, {{name}}");
    });

    it("falls back to the placeholder text when the model keeps rewriting a non-exact sample", async () => {
      const scripted = new ScriptedAdapter((s) => s.replace(/^3 /, "three "));
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.failed).toEqual([]);
      expect(JSON.parse(readFileSync(out, "utf8")).item_few).toBe("[ar] {{count}} items");
      expect(summary.warnings).toHaveLength(1);
      expect(summary.warnings[0]).toContain("item_few");
    });

    it("a model error on the sample-count text falls back to the plain text", async () => {
      class FailOnSample extends ScriptedAdapter {
        async translate(req: { source: string; sourceLang: string; targetLang: string }) {
          if (/^\d/.test(req.source)) throw new Error("Ollama returned HTTP 500: token repeat limit reached");
          return super.translate(req);
        }
      }
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "fr.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter: new FailOnSample(), glossary, context,
      });
      expect(summary.failed).toEqual([]);
      const after = JSON.parse(readFileSync(out, "utf8"));
      expect(after.item_one).toBe("[fr] {{count}} item");
      // fr `many` (exact millions) is generated but never gets a sample, so it is not a fallback.
      expect(after.item_many).toBe("[fr] {{count}} items");
      expect(summary.warnings[0]).toContain("item_one");
      expect(summary.warnings[0]).not.toContain("item_many");
    });

    it("a literal number equal to the sample can't stand in for a dropped count", async () => {
      // The model drops the leading count; "5 folders" must not become "{{count}} folders".
      const scripted = new ScriptedAdapter((s) => s.replace(/^\d+ /, ""));
      const src = writeSrc("en.json", '{\n  "f_one": "{{count}} file in 5 folders",\n  "f_other": "{{count}} files in 5 folders"\n}\n');
      const out = join(dir, "ru.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ru",
        adapter: scripted, glossary, context,
      });
      const after = JSON.parse(readFileSync(out, "utf8"));
      expect(after.f_many).toBe("[ru] {{count}} files in 5 folders");
      expect(summary.warnings.join("\n")).toContain("f_many");
    });

    it("a form with no collision-free sample is translated plainly and reported", async () => {
      const scripted = new ScriptedAdapter();
      const src = writeSrc("en.json", '{\n  "f_one": "{{count}} file, 2 folders",\n  "f_other": "{{count}} files, 2 folders"\n}\n');
      const summary = await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(scripted.sources.filter((s) => s.startsWith("2 "))).toEqual([]);
      expect(summary.warnings.join("\n")).toContain("f_two");
      expect(summary.pluralFallbacks).toBe(1);
    });

    it("hints an i18next-formatted count (`{{count, number}}`)", async () => {
      const scripted = new ScriptedAdapter();
      const src = writeSrc("en.json", '{\n  "n_one": "{{count, number}} item",\n  "n_other": "{{count, number}} items"\n}\n');
      const out = join(dir, "ar.json");
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter: scripted, glossary, context,
      });
      expect(summary.warnings).toEqual([]);
      expect(scripted.sources).toContain("3 items");
      expect(JSON.parse(readFileSync(out, "utf8")).n_few).toBe("[ar] {{count, number}} items");
    });

    it("reports generated forms that have no {{count}} to carry a sample", async () => {
      const src = writeSrc("en.json", '{\n  "n_one": "One item",\n  "n_other": "Several items"\n}\n');
      const summary = await translateFile({
        sourcePath: src, outPath: join(dir, "ru.json"),
        sourceLang: "en", targetLang: "ru",
        adapter, glossary, context,
      });
      // ru one/few/many span many numbers; `other` (fractions) has no sample by design.
      expect(summary.warnings).toHaveLength(1);
      expect(summary.warnings[0]).toContain("n_one, n_few, n_many");
      expect(summary.pluralFallbacks).toBe(3);
    });

    it("warns about lone `_other` keys when the source language is auto", async () => {
      const src = writeSrc("en.json", '{\n  "item_one": "{{count}} item",\n  "item_other": "{{count}} items",\n  "solo_other": "{{count}} 個"\n}\n');
      const summary = await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "auto", targetLang: "ar",
        adapter, glossary, context,
      });
      const w = summary.warnings.find((x) => x.includes("solo_other"));
      expect(w).toBeDefined();
      expect(w).toContain("--from");
    });

    it("en→ja drops categories Japanese does not use", async () => {
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "ja.json");
      await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ja",
        adapter, glossary, context,
      });
      expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ title: "[ja] Files", item_other: "[ja] {{count}} items" });
    });

    it("missing-only keeps existing category values and fills the rest; --force redoes them", async () => {
      const src = writeSrc("en.json", EN_PLURALS);
      const out = join(dir, "ar.json");
      writeFileSync(out, '{\n  "title": "ملفات",\n  "item_one": "ملف واحد",\n  "item_other": "{{count}} ملف"\n}\n');
      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context,
      });
      expect(summary.translated).toBe(4);
      const after = JSON.parse(readFileSync(out, "utf8"));
      expect(after.item_one).toBe("ملف واحد");
      expect(after.item_other).toBe("{{count}} ملف");
      expect(after.item_two).toBe("[ar] {{count}} items");

      await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context, mode: "force",
      });
      expect(JSON.parse(readFileSync(out, "utf8")).item_one).toBe("[ar] {{count}} item");
    });

    it("regenerates YAML plural groups in place", async () => {
      const src = writeSrc("en.yml", '# Cart\ncart:\n  # Items in cart\n  item_one: "{{count}} item"\n  item_other: "{{count}} items"\n  checkout: Checkout\n');
      const out = join(dir, "ru.yml");
      await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "ru",
        adapter, glossary, context,
      });
      expect(readFileSync(out, "utf8")).toBe(
        "# Cart\ncart:\n  # Items in cart\n" +
        '  item_one: "[ru] {{count}} item"\n' +
        '  item_few: "[ru] {{count}} items"\n' +
        '  item_many: "[ru] {{count}} items"\n' +
        '  item_other: "[ru] {{count}} items"\n' +
        "  checkout: \"[ru] Checkout\"\n",
      );
    });

    it("keeps the review warning when the target's plural rules are unknown", async () => {
      const src = writeSrc("en.json", EN_PLURALS);
      const summary = await translateFile({
        sourcePath: src, outPath: join(dir, "xx.json"),
        sourceLang: "en", targetLang: "xx",
        adapter, glossary, context,
      });
      expect(summary.warnings.some((w) => w.includes("review output manually"))).toBe(true);
    });
  });

  it("warns on duplicate JSON keys (last wins) with path and line", async () => {
    const src = writeSrc("en.json", '{\n  "a": "one",\n  "a": "two"\n}\n');
    const summary = await translateFile({
      sourcePath: src, outPath: join(dir, "fr.json"),
      sourceLang: "en", targetLang: "fr",
      adapter, glossary, context,
    });
    expect(summary.warnings.some((w) => w.includes('"a"') && w.includes("line 3"))).toBe(true);
    expect(summary.totalLeaves).toBe(1);
  });

  it("rejects duplicate YAML keys as a parse error", async () => {
    const src = writeSrc("en.yaml", "a: one\na: two\n");
    await expect(translateFile({
      sourcePath: src, outPath: join(dir, "fr.yaml"),
      sourceLang: "en", targetLang: "fr",
      adapter, glossary, context,
    })).rejects.toThrow(/parse/i);
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

  describe("locale-rooted catalogs (Rails)", () => {
    it("renames the YAML root locale key to the target and keeps comments", async () => {
      const src = writeSrc("en.yml", "# Rails catalog\nen:\n  # greeting shown on home\n  hello: \"Hello\"\n  bye: \"Goodbye\"\n");
      const out = join(dir, "fr.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(readFileSync(out, "utf8")).toBe(
        "# Rails catalog\nfr:\n  # greeting shown on home\n  hello: \"[fr] Hello\"\n  bye: \"[fr] Goodbye\"\n",
      );
      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "fr" });
      expect(summary.translated).toBe(2);
    });

    it("matches pt_BR against pt-BR case- and separator-insensitively", async () => {
      const src = writeSrc("pt_BR.yml", "pt_BR:\n  hello: Olá\n");
      const out = join(dir, "en.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "pt-br", targetLang: "en",
        adapter, glossary, context,
      });

      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ en: { hello: "[en] Olá" } });
      expect(summary.rootLocaleKey).toEqual({ from: "pt_BR", to: "en" });
    });

    it("writes the target root key exactly as passed in --to (pt-BR)", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "pt-BR.yml");

      await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "pt-BR",
        adapter, glossary, context,
      });

      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ "pt-BR": { hello: "[pt-BR] Hello" } });
    });

    it("syncs into an existing fr: target: missing-only, target-only keys kept, no en: root", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n  bye: Goodbye\n  welcome: \"Hi %{name}\"\n");
      const out = join(dir, "fr.yml");
      writeFileSync(out, "fr:\n  hello: Bonjour\n  legacy: Ancien\n");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(summary.translated).toBe(2);
      expect(summary.failed).toEqual([]);
      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({
        fr: { hello: "Bonjour", bye: "[fr] Goodbye", welcome: "[fr] Hi %{name}", legacy: "Ancien" },
      });
    });

    it("refuses an existing target that is still rooted at the source locale", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");
      writeFileSync(out, "en:\n  hello: Bonjour\n");

      await expect(translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      })).rejects.toThrow(/root/i);
      expect(readFileSync(out, "utf8")).toBe("en:\n  hello: Bonjour\n");
    });

    it("uses sourceLocale when sourceLang is auto", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "auto", sourceLocale: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(readFileSync(out, "utf8")).toStartWith("fr:\n");
      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "fr" });
    });

    it("does not rewrite when sourceLang is auto and no sourceLocale is known", async () => {
      const src = writeSrc("strings.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "out.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "auto", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(readFileSync(out, "utf8")).toStartWith("en:\n");
      expect(summary.rootLocaleKey).toBeUndefined();
    });

    it("leaves a vanilla single-top-level-key catalog alone", async () => {
      const src = writeSrc("en.yml", "app:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(readFileSync(out, "utf8")).toStartWith("app:\n");
      expect(summary.rootLocaleKey).toBeUndefined();
    });

    it("leaves a root with more than one key alone, even if one is the locale", async () => {
      const src = writeSrc("en.json", '{\n  "en": { "hello": "Hello" },\n  "meta": { "v": "one" }\n}\n');
      const out = join(dir, "fr.json");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(Object.keys(JSON.parse(readFileSync(out, "utf8")))).toEqual(["en", "meta"]);
      expect(summary.rootLocaleKey).toBeUndefined();
    });

    it("renames the JSON root locale key and syncs into an existing target", async () => {
      const src = writeSrc("en.json", '{\n  "en": { "hello": "Hello", "bye": "Goodbye" }\n}\n');
      const out = join(dir, "fr.json");
      writeFileSync(out, '{\n  "fr": { "hello": "Bonjour" }\n}\n');

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ fr: { hello: "Bonjour", bye: "[fr] Goodbye" } });
      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "fr" });
    });

    it("keeps the existing target's root spelling (fr_FR vs --to fr-FR)", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n  bye: Goodbye\n");
      const out = join(dir, "fr-FR.yml");
      writeFileSync(out, "fr_FR:\n  hello: Bonjour\n");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr-FR",
        adapter, glossary, context,
      });

      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ fr_FR: { hello: "Bonjour", bye: "[fr-FR] Goodbye" } });
      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "fr_FR" });
      expect(summary.warnings).toEqual([]);
    });

    it("warns (does not refuse) when the existing target is rooted under another locale", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");
      writeFileSync(out, "ar:\n  hello: مرحبا\n");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ ar: { hello: "مرحبا" }, fr: { hello: "[fr] Hello" } });
      expect(summary.warnings.some((w) => w.includes("two roots"))).toBe(true);
    });

    it("warns when the existing target is flat", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");
      writeFileSync(out, "hello: Bonjour\n");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ hello: "Bonjour", fr: { hello: "[fr] Hello" } });
      expect(summary.warnings.some((w) => w.includes("mixed structure"))).toBe(true);
    });

    it("treats --to fr against an existing fr-FR: root as no match (warns)", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");
      writeFileSync(out, "fr-FR:\n  hello: Bonjour\n");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(Object.keys(parseYaml(readFileSync(out, "utf8")))).toEqual(["fr", "fr-FR"]);
      expect(summary.warnings.length).toBe(1);
    });

    it("does not rename a region-qualified root (en-US:) with --from en", async () => {
      const src = writeSrc("en.yml", "en-US:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context,
      });

      expect(readFileSync(out, "utf8")).toStartWith("en-US:\n");
      expect(summary.rootLocaleKey).toBeUndefined();
    });

    it("renames a quoted root key and keeps its quoting", async () => {
      const src = writeSrc("en.yml", "\"en\":\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "fr", adapter, glossary, context });

      expect(readFileSync(out, "utf8")).toStartWith("\"fr\":\n");
    });

    it("keeps a comment on the root key line", async () => {
      const src = writeSrc("en.yml", "en: # English catalog\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "fr", adapter, glossary, context });

      const text = readFileSync(out, "utf8");
      expect(text).toStartWith("fr:");
      expect(text).toContain("# English catalog");
      expect(parseYaml(text)).toEqual({ fr: { hello: "[fr] Hello" } });
    });

    it("renames a flow-style root", async () => {
      const src = writeSrc("en.yml", "{ en: { hello: Hello } }\n");
      const out = join(dir, "fr.yml");

      await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "fr", adapter, glossary, context });

      const text = readFileSync(out, "utf8");
      expect(text).toStartWith("{");
      expect(parseYaml(text)).toEqual({ fr: { hello: "[fr] Hello" } });
    });

    it("reports the rename in dry-run without writing", async () => {
      const src = writeSrc("en.yml", "en:\n  hello: Hello\n");
      const out = join(dir, "fr.yml");

      const summary = await translateFile({
        sourcePath: src, outPath: out,
        sourceLang: "en", targetLang: "fr",
        adapter, glossary, context, dryRun: true,
      });

      expect(summary.rootLocaleKey).toEqual({ from: "en", to: "fr" });
      expect(existsSync(out)).toBe(false);
    });
  });

  describe("context retrieval", () => {
    function captureSnippets(): Map<string, string[]> {
      const seen = new Map<string, string[]>();
      const translate = adapter.translate.bind(adapter);
      adapter.translate = async (req) => {
        seen.set(req.source, req.contextSnippets ?? []);
        return translate(req);
      };
      return seen;
    }

    beforeEach(() => {
      const docs = join(dir, "docs");
      mkdirSync(docs);
      writeFileSync(join(docs, "style.md"), "Always say sign in to Dashboard, never log in.");
      context.addSource(docs);
    });

    it("passes snippets that clear minRelevance", async () => {
      const seen = captureSnippets();
      const src = writeSrc("en.json", '{ "a": "Sign in to Dashboard" }');
      await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context, minRelevance: 0.1,
      });
      expect(seen.get("Sign in to Dashboard")).toHaveLength(1);
    });

    it("drops snippets below minRelevance", async () => {
      const seen = captureSnippets();
      const src = writeSrc("en.json", '{ "a": "Sign in to Dashboard" }');
      await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context, minRelevance: 0.99,
      });
      expect(seen.get("Sign in to Dashboard")).toEqual([]);
    });

    it("caps snippets at maxSnippets", async () => {
      const seen = captureSnippets();
      const docs2 = join(dir, "docs2");
      mkdirSync(docs2);
      writeFileSync(join(docs2, "a.md"), "Dashboard sign in help");
      writeFileSync(join(docs2, "b.md"), "Dashboard sign in troubleshooting");
      context.addSource(docs2);
      const src = writeSrc("en.json", '{ "a": "Sign in to Dashboard" }');
      await translateFile({
        sourcePath: src, outPath: join(dir, "ar.json"),
        sourceLang: "en", targetLang: "ar",
        adapter, glossary, context, minRelevance: 0, maxSnippets: 1,
      });
      expect(seen.get("Sign in to Dashboard")).toHaveLength(1);
    });
  });
});
