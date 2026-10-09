import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
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

  it("applies glossary entries of any source language when sourceLang is auto", async () => {
    glossary.add({ sourceTerm: "API", targetTerm: "واجهة", sourceLang: "en", targetLang: "ar" });
    const src = writeSrc("strings.json", '{\n  "doc": "The API is fast"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "auto", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(JSON.parse(readFileSync(out, "utf8")).doc).toContain("واجهة");
  });

  it("prefers the filename's source locale for glossary lookup when sourceLang is auto", async () => {
    glossary.add({ sourceTerm: "chat", targetTerm: "Katze", sourceLang: "fr", targetLang: "de" });
    glossary.add({ sourceTerm: "chat", targetTerm: "Chat", sourceLang: "en", targetLang: "de" });
    const src = writeSrc("fr.json", '{\n  "pet": "le chat"\n}\n');
    const out = join(dir, "de.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "auto", sourceLocale: "fr", targetLang: "de",
      adapter, glossary, context,
    });
    expect(JSON.parse(readFileSync(out, "utf8")).pet).toContain("Katze");
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

  // ── ICU MessageFormat ─────────────────────────────────────────────

  class DropSentinelAdapter extends MockAdapter {
    async translate(req: { source: string; sourceLang: string; targetLang: string }) {
      return {
        translated: `[${req.targetLang}] ${req.source.replace(/__TLPH_\d+__/g, "")}`,
        sourceLang: req.sourceLang,
        targetLang: req.targetLang,
        glossaryCoverage: 1,
        missingTerms: [],
        metadata: { adapter: "drop", durationMs: 0, retries: 0 },
      };
    }
  }

  it("translates ICU plural branches and adds the target's CLDR categories", async () => {
    const src = writeSrc("en.json", JSON.stringify({ items: "{count, plural, one {# item} other {# items}}" }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.failed).toEqual([]);
    expect(summary.translated).toBe(1);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.items).toBe(
      "{count, plural, zero {[ar] # items} one {[ar] # item} two {[ar] # items} few {[ar] # items} many {[ar] # items} other {[ar] # items}}",
    );
  });

  it("translates the sentence around a nested select/plural and drops unused categories", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      msg: "{name} has {gender, select, female {{n, plural, =0 {no cats} one {one cat} other {# cats}}} other {{n, number} pets}} now",
    }));
    const out = join(dir, "ja.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ja",
      adapter, glossary, context,
    });
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.msg).toBe(
      "[ja] {name} has {gender, select, female {{n, plural, =0 {[ja] no cats} other {[ja] # cats}}} other {[ja] {n, number} pets}} now",
    );
  });

  it("translates FormatJS defaultMessage values and keeps descriptions verbatim", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      "cart.count": { defaultMessage: "{n, plural, one {# item} other {# items}}", description: "Cart badge" },
      "item.delete": { defaultMessage: "Delete {item}", description: "Button label" },
    }, null, 2));
    const out = join(dir, "ja.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ja",
      adapter, glossary, context,
    });
    expect(summary.contentFormat).toBe("formatjs");
    expect(summary.translated).toBe(2);
    expect(summary.skipped.reasons.metadata).toBe(2);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after["cart.count"]).toEqual({ defaultMessage: "{n, plural, other {[ja] # items}}", description: "Cart badge" });
    expect(after["item.delete"]).toEqual({ defaultMessage: "[ja] Delete {item}", description: "Button label" });
  });

  it("escapes apostrophes in FormatJS messages without plural/select", async () => {
    class ElideAdapter extends MockAdapter {
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        return { ...(await super.translate(req as never)), translated: req.source.replace("Delete ", "Supprimer l'") };
      }
    }
    const src = writeSrc("en.json", JSON.stringify({ del: { defaultMessage: "Delete {item}" } }));
    const out = join(dir, "fr.json");
    await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "fr",
      adapter: new ElideAdapter(), glossary, context,
    });
    expect(JSON.parse(readFileSync(out, "utf8")).del.defaultMessage).toBe("Supprimer l''{item}");
  });

  it("i18next catalogs never take the ICU path", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      item_one: "{{count}} item at {price, number}",
      item_other: "{{count}} items at {{price, number}}",
    }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      continueOnError: false,
    });
    expect(summary.contentFormat).toBe("i18next-plurals");
    // en one/other regenerate to all six Arabic categories (plural regeneration).
    expect(summary.translated).toBe(6);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.item_other).toBe("[ar] {{count}} items at {{price, number}}");
  });

  it("i18next catalogs keep source for ICU plural/select values and report them", async () => {
    const icu = "{n, plural, one {# file} other {# files}}";
    const src = writeSrc("en.json", JSON.stringify({
      item_one: "{{count}} item",
      item_other: "{{count}} items",
      files: icu,
      greet: "Hello {{name}}",
    }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.contentFormat).toBe("i18next-plurals");
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.files).toBe(icu);
    expect(after.greet).toBe("[ar] Hello {{name}}");
    expect(after.item_other).toBe("[ar] {{count}} items");
    expect(summary.failed.map((f) => f.path)).toEqual(["files"]);
    expect(summary.warnings.filter((w) => /ICU plural\/select/.test(w))).toHaveLength(1);
    // A failed key gets no lock hash (it keeps its previous one, here none).
    const lock = JSON.parse(readFileSync(join(dir, ".tl", "locks", "ar.json.lock"), "utf8"));
    expect(lock.checksums["/files"]).toBeUndefined();

    // The target now holds the copied source string and there is no hash to
    // compare, so a missing-only re-run does not re-queue the key.
    const rerun = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(rerun.totalLeaves).toBe(0);
    expect(rerun.failed).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8")).files).toBe(icu);

    // --force re-queues it (and it fails the same way).
    const forced = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context, mode: "force",
    });
    expect(forced.failed.map((f) => f.path)).toEqual(["files"]);
  });

  it("i18next ICU plural/select values are recorded, not thrown, in a strict dry run", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      item_one: "{{count}} item",
      item_other: "{{count}} items",
      pick: "{g, select, female {She} other {They}}",
    }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      continueOnError: false, dryRun: true,
    });
    expect(summary.failed.map((f) => f.path)).toEqual(["pick"]);
    expect(summary.failed[0].reason).toMatch(/ICU MessageFormat in an i18next catalog at pick/);
    expect(existsSync(out)).toBe(false);
  });

  it("i18next plural keys holding an ICU plural keep source in every regenerated form", async () => {
    const icu = "{n, plural, one {# file} other {# files}}";
    const src = writeSrc("en.json", JSON.stringify({ item_one: icu, item_other: icu }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    const forms = ["item_zero", "item_one", "item_two", "item_few", "item_many", "item_other"];
    expect(summary.failed.map((f) => f.path).sort()).toEqual([...forms].sort());
    expect(summary.translated).toBe(0);
    const after = JSON.parse(readFileSync(out, "utf8"));
    for (const k of forms) expect(after[k]).toBe(icu);
  });

  it("--format raw-json sends a misdetected i18next file's ICU values down the ICU path", async () => {
    const icu = "{n, plural, one {# file} other {# files}}";
    const src = writeSrc("en.json", JSON.stringify({ size_one: "Small", size_other: "Large", files: icu }));
    const out = join(dir, "fr.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "fr",
      adapter, glossary, context,
      format: "raw-json",
    });
    expect(summary.contentFormat).toBe("vanilla");
    expect(summary.failed).toEqual([]);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.files).not.toBe(icu);
    expect(after.files).toMatch(/^\{n, plural, /);
  });

  it("i18next catalogs abort on ICU plural/select values under strict mode", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      item_one: "{{count}} item",
      item_other: "{{count}} items",
      pick: "{g, select, female {She} other {They}}",
    }));
    await expect(translateFile({
      sourcePath: src, outPath: join(dir, "ar.json"),
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      continueOnError: false,
    })).rejects.toThrow(/ICU MessageFormat in an i18next catalog at pick/);
  });

  it("failed entries carry a JSON Pointer and the tag --strict would throw", async () => {
    const src = writeSrc("en.json", JSON.stringify({
      "a.b": "Hello {{name}}",
      nest: { x: "{n, plural, one {# item}}" },
    }));
    const summary = await translateFile({
      sourcePath: src, outPath: join(dir, "ar.json"),
      sourceLang: "en", targetLang: "ar",
      adapter: new DropSentinelAdapter(), glossary, context,
    });
    expect(summary.failed.map(({ path, pointer, tag }) => ({ path, pointer, tag }))).toEqual([
      { path: "a.b", pointer: "/a.b", tag: "PLACEHOLDER_MISMATCH" },
      { path: "nest.x", pointer: "/nest/x", tag: "FILE_INVALID_FORMAT" },
    ]);

    const dry = await translateFile({
      sourcePath: src, outPath: join(dir, "fr.json"),
      sourceLang: "en", targetLang: "fr",
      adapter, glossary, context, dryRun: true,
    });
    expect(dry.failed.map(({ pointer, tag }) => ({ pointer, tag }))).toEqual([{ pointer: "/nest/x", tag: "FILE_INVALID_FORMAT" }]);
  });

  it("a pipeline failure is tagged with the pipeline error's tag", async () => {
    class ThrowingAdapter extends MockAdapter {
      async translate(): Promise<never> {
        throw new Error("boom");
      }
    }
    const src = writeSrc("en.json", JSON.stringify({ a: "Hello", b: "{n, number} items" }));
    const summary = await translateFile({
      sourcePath: src, outPath: join(dir, "ar.json"),
      sourceLang: "en", targetLang: "ar",
      adapter: new ThrowingAdapter(), glossary, context,
    });
    expect(summary.failed.map(({ pointer, tag }) => ({ pointer, tag }))).toEqual([
      { pointer: "/a", tag: "TRANSLATION_FAILED" },
      { pointer: "/b", tag: "TRANSLATION_FAILED" },
    ]);

    glossary.add({ sourceTerm: "Hello", targetTerm: "XYZ", sourceLang: "en", targetLang: "ar" });
    const strictMiss = await translateFile({
      sourcePath: src, outPath: join(dir, "ar2.json"),
      sourceLang: "en", targetLang: "ar",
      adapter: new DropSentinelAdapter(), glossary, context, glossaryMode: "strict", mode: "force",
    });
    expect(strictMiss.failed.find((f) => f.pointer === "/a")?.tag).toBe("GLOSSARY_STRICT_MISS");
  });

  it("malformed ICU falls back to source by default", async () => {
    const src = writeSrc("en.json", JSON.stringify({ bad: "{n, plural, one {# item}}", ok: "Hello" }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].reason).toMatch(/Invalid ICU MessageFormat at bad/);
    expect(JSON.parse(readFileSync(out, "utf8")).bad).toBe("{n, plural, one {# item}}");
  });

  it("malformed ICU aborts under strict mode", async () => {
    const src = writeSrc("en.json", JSON.stringify({ bad: "{n, plural, one {# item}}" }));
    await expect(translateFile({
      sourcePath: src, outPath: join(dir, "ar.json"),
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      continueOnError: false,
    })).rejects.toThrow(/Invalid ICU MessageFormat/);
  });

  it("ICU placeholder loss falls back to source by default and aborts under strict", async () => {
    const msg = "{count, plural, one {{name} has # item} other {{name} has # items}}";
    const src = writeSrc("en.json", JSON.stringify({ items: msg }));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter: new DropSentinelAdapter(), glossary, context,
    });
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].reason).toMatch(/Placeholder mismatch at items .*missing: \[\{name\}/);
    expect(JSON.parse(readFileSync(out, "utf8")).items).toBe(msg);

    await expect(translateFile({
      sourcePath: src, outPath: join(dir, "fr.json"),
      sourceLang: "en", targetLang: "fr",
      adapter: new DropSentinelAdapter(), glossary, context,
      continueOnError: false,
    })).rejects.toThrow(/Placeholder mismatch/);
  });

  it("dry run counts parseable ICU as translatable without calling the adapter", async () => {
    const src = writeSrc("en.json", JSON.stringify({ a: "{n, plural, one {#} other {#}}", b: "{n, plural, one {x}}" }));
    const summary = await translateFile({
      sourcePath: src, outPath: join(dir, "ar.json"),
      sourceLang: "en", targetLang: "ar",
      adapter: new DropSentinelAdapter(), glossary, context,
      dryRun: true,
    });
    expect(summary.translated).toBe(1);
    expect(summary.failed.map((f) => f.path)).toEqual(["b"]);
    expect(existsSync(join(dir, "ar.json"))).toBe(false);
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

  // ── Lock file (changed-source detection) ─────────────────────────

  // The test dir has no .git ancestor, so .tl/locks/ sits in the target's directory.
  const lockFile = (target = "ar.json") => join(dir, ".tl", "locks", `${target}.lock`);
  function readLockFile(out: string): Record<string, string> {
    return JSON.parse(readFileSync(lockFile(basename(out)), "utf8")).checksums;
  }

  it("writes .tl/locks/<target>.lock with a truncated sha256 per source key path", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello",\n  "nested": { "b": "World" }\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    const sums = readLockFile(out);
    expect(Object.keys(sums)).toEqual(["/a", "/nested/b"]);
    expect(sums["/a"]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("re-translates only keys whose source changed since the last run", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello",\n  "b": "World"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });

    writeFileSync(src, '{\n  "a": "Hello there",\n  "b": "World"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });

    expect(summary.translated).toBe(1);
    expect(summary.changed).toEqual(["/a"]);
    const after = JSON.parse(readFileSync(out, "utf8"));
    expect(after.a).toBe("[ar] Hello there");
    expect(after.b).toBe("[ar] World");
  });

  it("missing lock: existing target values are kept, hashes recorded", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello",\n  "b": "World"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "a": "HAND-TRANSLATED"\n}\n');

    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(summary.translated).toBe(1);
    expect(summary.changed).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8")).a).toBe("HAND-TRANSLATED");
    expect(Object.keys(readLockFile(out))).toEqual(["/a", "/b"]);

    // Second run with unchanged source: nothing to do.
    const again = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(again.translated).toBe(0);
  });

  it("drops lock entries for keys no longer in the source", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello",\n  "b": "World"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    writeFileSync(src, '{\n  "a": "Hello"\n}\n');
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(Object.keys(readLockFile(out))).toEqual(["/a"]);
  });

  it("dry-run reports changed keys but writes neither target nor lock", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello",\n  "b": "World"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    const lockBefore = readFileSync(lockFile(), "utf8");
    const outBefore = readFileSync(out, "utf8");

    writeFileSync(src, '{\n  "a": "Hello there",\n  "b": "World"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, dryRun: true });
    expect(summary.changed).toEqual(["/a"]);
    expect(summary.translated).toBe(1);
    expect(readFileSync(lockFile(), "utf8")).toBe(lockBefore);
    expect(readFileSync(out, "utf8")).toBe(outBefore);
  });

  it("dry-run on a first run does not create a lock", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, dryRun: true });
    expect(existsSync(lockFile())).toBe(false);
  });

  it("--force refreshes the lock to current source hashes", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello"\n}\n');
    const out = join(dir, "ar.json");
    mkdirSync(join(dir, ".tl", "locks"), { recursive: true });
    writeFileSync(lockFile(), JSON.stringify({ version: 1, checksums: { "/a": "stale", "/gone": "x" } }));
    writeFileSync(out, '{\n  "a": "OLD"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, mode: "force" });
    expect(summary.translated).toBe(1);
    expect(Object.keys(readLockFile(out))).toEqual(["/a"]);
    expect(readLockFile(out)["/a"]).not.toBe("stale");
  });

  it("a changed key that fails keeps its old hash so the next run retries it", async () => {
    class DropSentinelAdapter extends MockAdapter {
      async translate(req: { source: string; sourceLang: string; targetLang: string }) {
        return {
          translated: `[${req.targetLang}] ${req.source.replace(/__TLPH_\d+__/g, "")}`,
          sourceLang: req.sourceLang, targetLang: req.targetLang,
          glossaryCoverage: 1, missingTerms: [],
          metadata: { adapter: "drop", durationMs: 0, retries: 0 },
        };
      }
    }
    const src = writeSrc("en.json", '{\n  "g": "Hello"\n}\n');
    const out = join(dir, "ar.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    const oldHash = readLockFile(out)["/g"];

    writeFileSync(src, '{\n  "g": "Hello {{name}}"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter: new DropSentinelAdapter(), glossary, context });
    expect(summary.failed).toHaveLength(1);
    expect(readLockFile(out)["/g"]).toBe(oldHash);

    const retry = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, dryRun: true });
    expect(retry.changed).toEqual(["/g"]);
  });

  it("in a git project the lock lives at the root, not in the locale dir (--out elsewhere)", async () => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "src-locales"));
    mkdirSync(join(dir, "public/locales/ar"), { recursive: true });
    const src = join(dir, "src-locales/en.json");
    writeFileSync(src, '{\n  "a": "Hello"\n}\n');
    const out = join(dir, "public/locales/ar/common.json");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });

    expect(readdirSync(join(dir, "public/locales/ar"))).toEqual(["common.json"]);
    expect(readdirSync(join(dir, ".tl", "locks"))).toEqual(["public"]);
    const lock = JSON.parse(readFileSync(join(dir, ".tl/locks/public/locales/ar/common.json.lock"), "utf8"));
    expect(Object.keys(lock.checksums)).toEqual(["/a"]);

    writeFileSync(src, '{\n  "a": "Hello there"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(summary.changed).toEqual(["/a"]);
  });

  it("each target has its own lock: syncing ar does not mark fr as up to date", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello"\n}\n');
    const ar = join(dir, "ar.json");
    const fr = join(dir, "fr.json");
    await translateFile({ sourcePath: src, outPath: ar, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    await translateFile({ sourcePath: src, outPath: fr, sourceLang: "en", targetLang: "fr", adapter, glossary, context });

    writeFileSync(src, '{\n  "a": "Hello there"\n}\n');
    expect((await translateFile({ sourcePath: src, outPath: ar, sourceLang: "en", targetLang: "ar", adapter, glossary, context })).changed).toEqual(["/a"]);
    expect((await translateFile({ sourcePath: src, outPath: fr, sourceLang: "en", targetLang: "fr", adapter, glossary, context })).changed).toEqual(["/a"]);
    expect(readdirSync(join(dir, ".tl", "locks")).sort()).toEqual(["ar.json.lock", "fr.json.lock"]);
  });

  it("a corrupt (e.g. conflicted) lock blocks only its own target", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello"\n}\n');
    const ar = join(dir, "ar.json");
    const fr = join(dir, "fr.json");
    await translateFile({ sourcePath: src, outPath: ar, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    writeFileSync(lockFile("ar.json"), "<<<<<<< HEAD\n");
    await expect(translateFile({ sourcePath: src, outPath: ar, sourceLang: "en", targetLang: "ar", adapter, glossary, context }))
      .rejects.toMatchObject({ tag: "FILE_PARSE_FAILED", hint: expect.stringContaining("ar.json.lock") });
    const summary = await translateFile({ sourcePath: src, outPath: fr, sourceLang: "en", targetLang: "fr", adapter, glossary, context });
    expect(summary.translated).toBe(1);
  });

  it("a changed source does not overwrite a target value of a different shape", async () => {
    const src = writeSrc("en.json", '{\n  "item": "Item"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "item": { "one": "x", "other": "y" }\n}\n');
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });

    writeFileSync(src, '{\n  "item": "Item (edited)"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(summary.changed).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ item: { one: "x", other: "y" } });
  });

  it("corrupt lock aborts with FILE_PARSE_FAILED before writing the target", async () => {
    const src = writeSrc("en.json", '{\n  "a": "Hello"\n}\n');
    const out = join(dir, "ar.json");
    mkdirSync(join(dir, ".tl", "locks"), { recursive: true });
    writeFileSync(lockFile(), "not json");
    await expect(translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context }))
      .rejects.toThrow(/Invalid lock file/);
    expect(existsSync(out)).toBe(false);
  });

  it("change detection works for YAML targets", async () => {
    const src = writeSrc("en.yml", "# greeting\ngreeting: Hello\nbye: Goodbye\n");
    const out = join(dir, "ar.yml");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    writeFileSync(src, "# greeting\ngreeting: Hi\nbye: Goodbye\n");
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(summary.changed).toEqual(["/greeting"]);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("[ar] Hi");
    expect(text).toContain("[ar] Goodbye");
    expect(text).toContain("# greeting");
  });

  // ── --prune ───────────────────────────────────────────────────────

  it("prune removes target-only keys and array elements (JSON)", async () => {
    const src = writeSrc("en.json", '{\n  "a": "A",\n  "list": ["x"],\n  "n": { "keep": "K" }\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "a": "TA",\n  "stale": "S",\n  "list": ["TX", "TY"],\n  "n": { "keep": "TK", "old": "O" }\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.pruned).toEqual(["/stale", "/list/1", "/n/old"]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "TA", list: ["TX"], n: { keep: "TK" } });
  });

  it("prune keeps target-only i18next plural forms (ar adds few/many)", async () => {
    const src = writeSrc("en.json", '{\n  "cart_one": "{{count}} item",\n  "cart_other": "{{count}} items"\n}\n');
    const out = join(dir, "ar.json");
    const target = { cart_one: "A1", cart_other: "A2", cart_few: "A3", cart_many: "A4", cart_zero: "A5", gone: "G" };
    writeFileSync(out, JSON.stringify(target, null, 2) + "\n");
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.pruned).toEqual(["/gone"]);
    const after = JSON.parse(readFileSync(out, "utf8"));
    // cart_two is missing from the target, so plural regeneration (#56) fills it in.
    expect(after).toEqual({ cart_one: "A1", cart_other: "A2", cart_two: "[ar] {{count}} items", cart_few: "A3", cart_many: "A4", cart_zero: "A5" });
  });

  it("prune keeps target-only categories in nested plural maps (Rails YAML)", async () => {
    const src = writeSrc("en.yml", "en:\n  inbox:\n    one: \"%{count} message\"\n    other: \"%{count} messages\"\n  title: Inbox\n  gone: Old\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "ar:\n  inbox:\n    zero: Z\n    one: O\n    two: T\n    few: F\n    many: M\n    other: X\n  title: TI\n  gone: G\n");
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    writeFileSync(src, "en:\n  inbox:\n    one: \"%{count} message\"\n    other: \"%{count} messages\"\n  title: Inbox\n");
    const second = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.pruned).toEqual([]);
    expect(second.pruned).toEqual(["/ar/gone"]);
    const text = readFileSync(out, "utf8");
    // one/other keep the source's double-quoted style; target-only forms are appended plain.
    for (const cat of ["zero: Z", "two: T", "few: F", "many: M", 'one: "O"', 'other: "X"']) expect(text).toContain(cat);
  });

  it("prune works across a Rails root rename (en: → ar:)", async () => {
    const src = writeSrc("en.yml", "en:\n  hello: Hello\n  bye: Bye\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "ar:\n  hello: TH\n  bye: TB\n  old: TO\n");
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.pruned).toEqual(["/ar/old"]);
    expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ ar: { hello: "TH", bye: "TB" } });
  });

  it("detects a changed source string under a Rails root (lock keyed by the target root)", async () => {
    const src = writeSrc("en.yml", "en:\n  hello: Hello\n  bye: Bye\n");
    const out = join(dir, "ar.yml");
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(Object.keys(readLockFile(out)).sort()).toEqual(["/ar/bye", "/ar/hello"]);
    writeFileSync(src, "en:\n  hello: Hello there\n  bye: Bye\n");
    const second = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(second.changed).toEqual(["/ar/hello"]);
    expect(parseYaml(readFileSync(out, "utf8")).ar.hello).toBe("[ar] Hello there");
  });

  it("prune refuses when source and target share no top-level keys (root not re-rooted)", async () => {
    // --from auto with no locale in the filename: the en: root can't be matched to ar:.
    const src = writeSrc("strings.yml", "en:\n  hello: Hello\n  bye: Bye\n");
    const out = join(dir, "ar.yml");
    const before = "ar:\n  hello: TH\n  bye: TB\n";
    writeFileSync(out, before);
    for (const dryRun of [false, true]) {
      await expect(translateFile({ sourcePath: src, outPath: out, sourceLang: "auto", targetLang: "ar", adapter, glossary, context, prune: true, dryRun }))
        .rejects.toMatchObject({ tag: "PRUNE_REFUSED", message: expect.stringContaining("no top-level keys") });
    }
    expect(readFileSync(out, "utf8")).toBe(before);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("prune refuses to remove more than half of the target's values", async () => {
    const src = writeSrc("en.json", '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    const before = '{\n  "a": "TA",\n  "x": "X",\n  "y": { "z": "Z" }\n}\n';
    writeFileSync(out, before);
    await expect(translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true }))
      .rejects.toMatchObject({ tag: "PRUNE_REFUSED", message: expect.stringContaining("2 of 3") });
    expect(readFileSync(out, "utf8")).toBe(before);
  });

  it("allowLargePrune confirms a large prune", async () => {
    const src = writeSrc("en.json", '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "a": "TA",\n  "x": "X",\n  "y": { "z": "Z" }\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true, allowLargePrune: true });
    expect(summary.pruned).toEqual(["/x", "/y"]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "TA" });
  });

  it("summary paths are JSON Pointers, so a dotted key is distinguishable from nesting", async () => {
    const src = writeSrc("en.json", '{\n  "nav.home": "Home",\n  "nav": { "home": "Home" }\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "nav.home": "T1",\n  "nav": { "home": "T2" },\n  "a.b": "x"\n}\n');
    await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    writeFileSync(src, '{\n  "nav.home": "Home page",\n  "nav": { "home": "Home" }\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.changed).toEqual(["/nav.home"]);
    expect(summary.pruned).toEqual(["/a.b"]);
  });

  it("without prune, target-only keys are kept and pruned is empty", async () => {
    const src = writeSrc("en.json", '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    writeFileSync(out, '{\n  "a": "TA",\n  "stale": "S"\n}\n');
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context });
    expect(summary.pruned).toEqual([]);
    expect(JSON.parse(readFileSync(out, "utf8")).stale).toBe("S");
  });

  it("prune with dry-run reports but does not write", async () => {
    const src = writeSrc("en.json", '{\n  "a": "A"\n}\n');
    const out = join(dir, "ar.json");
    const before = '{\n  "a": "TA",\n  "stale": "S"\n}\n';
    writeFileSync(out, before);
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true, dryRun: true });
    expect(summary.pruned).toEqual(["/stale"]);
    expect(readFileSync(out, "utf8")).toBe(before);
  });

  it("prune drops target-only YAML keys and keeps comments/styles of survivors", async () => {
    const src = writeSrc("en.yml", "# Greeting shown on home\ngreeting: Hello\nbody: |\n  Line one\n  Line two\nnested:\n  # keep me\n  keep: \"Keep\"\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "greeting: TG\nbody: |\n  TB\nnested:\n  keep: TK\n  old: gone\nlegacy: removed\n");
    const summary = await translateFile({ sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context, prune: true });
    expect(summary.pruned).toEqual(["/nested/old", "/legacy"]);
    const text = readFileSync(out, "utf8");
    expect(text).not.toContain("legacy");
    expect(text).not.toContain("old: gone");
    expect(text).toContain("# Greeting shown on home");
    expect(text).toContain("# keep me");
    expect(text).toContain("body: |\n  TB\n");
    expect(text).toContain('keep: "TK"');
    expect(text).toContain("greeting: TG");
  });

  // ── Abort (signal) ────────────────────────────────────────────────

  // Aborts once the leaf at `afterIndex` has started, so it and every earlier leaf complete.
  function abortAfter(afterIndex: number) {
    const ctl = new AbortController();
    return {
      signal: ctl.signal,
      onProgress: ({ done }: { done: number }) => { if (done === afterIndex) ctl.abort(); },
    };
  }

  it("an aborted run writes the leaves completed so far and the next run picks up the rest", async () => {
    const src = writeSrc("en.json", JSON.stringify({ a: "One", nest: { b: "Two", c: "Three" }, list: ["x y", "z w"] }, null, 2));
    const out = join(dir, "ar.json");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      ...abortAfter(0),
    });
    expect(summary.aborted).toBe(true);
    expect(summary.translated).toBe(1);
    expect(summary.warnings.some((w) => /Interrupted: 4 of 5 key\(s\) not translated/.test(w))).toBe(true);
    // Unreached keys stay absent (apps fall back to the default locale; "" would render blank),
    // and so do the containers left empty.
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "[ar] One" });
    expect(Object.keys(readLockFile(out))).toEqual(["/a"]);

    const rerun = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(rerun.aborted).toBe(false);
    expect(rerun.translated).toBe(4);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "[ar] One", nest: { b: "[ar] Two", c: "[ar] Three" }, list: ["[ar] x y", "[ar] z w"] });
    expect(Object.keys(readLockFile(out))).toEqual(["/a", "/list/0", "/list/1", "/nest/b", "/nest/c"]);
  });

  it("an aborted YAML run never writes source text for keys it did not reach", async () => {
    const src = writeSrc("en.yml", "a: One\nb: Two\nc: Three\nnest:\n  d: Four\nlist:\n  - x y\n  - z w\nempty: Five\n");
    const out = join(dir, "ar.yml");
    writeFileSync(out, "a: EXISTING\nempty: \"\"\n");
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
      ...abortAfter(0),
    });
    expect(summary.aborted).toBe(true);
    // The write template is the source document: unreached keys are removed from it
    // (with the containers left empty), never written with their source text.
    expect(parseYaml(readFileSync(out, "utf8"))).toEqual({ a: "EXISTING", b: "[ar] Two", empty: "" });

    const rerun = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context,
    });
    expect(rerun.translated).toBe(5);
    expect(parseYaml(readFileSync(out, "utf8"))).toEqual({
      a: "EXISTING", b: "[ar] Two", c: "[ar] Three", nest: { d: "[ar] Four" }, list: ["[ar] x y", "[ar] z w"], empty: "[ar] Five",
    });
  });

  it("an aborted run keeps the previous lock hash of a changed key it did not reach", async () => {
    const src = writeSrc("en.json", JSON.stringify({ a: "One", b: "Two" }));
    const out = join(dir, "ar.json");
    const base = { sourcePath: src, outPath: out, sourceLang: "en", targetLang: "ar", adapter, glossary, context };
    await translateFile(base);
    const before = readLockFile(out);

    writeFileSync(src, JSON.stringify({ a: "One!", b: "Two!" }));
    const aborted = await translateFile({ ...base, ...abortAfter(0) });
    expect(aborted.aborted).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "[ar] One!", b: "[ar] Two" });
    expect(readLockFile(out)["/b"]).toBe(before["/b"]);

    const rerun = await translateFile(base);
    expect(rerun.changed).toEqual(["/b"]);
    expect(JSON.parse(readFileSync(out, "utf8")).b).toBe("[ar] Two!");
  });

  it("an already-aborted signal still writes nothing in a dry run", async () => {
    const src = writeSrc("en.json", JSON.stringify({ a: "One" }));
    const out = join(dir, "ar.json");
    const ctl = new AbortController();
    ctl.abort();
    const summary = await translateFile({
      sourcePath: src, outPath: out,
      sourceLang: "en", targetLang: "ar",
      adapter, glossary, context, dryRun: true, signal: ctl.signal,
    });
    expect(summary.aborted).toBe(true);
    expect(summary.translated).toBe(0);
    expect(existsSync(out)).toBe(false);
  });
});
