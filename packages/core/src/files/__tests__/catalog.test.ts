import { describe, test, expect } from "bun:test";
import type { CatalogFormat, Retarget } from "../catalog";
import { jsonFormat } from "../json";
import { yamlFormat } from "../yaml";
import { rebaseLocaleRoot } from "../locale-root";
import { diffForSync } from "../sync";
import type { JsonValue } from "../walk";

// Each scenario runs the steps translateFile takes on a target catalog:
// retarget, sync the pending leaves (the first `translate` of them get
// "[ar] <source>", the rest are reverted as an abort leaves them), serialize.
type Scenario = {
  name: string;
  source: JsonValue;
  /** The same catalog as YAML, comments and styles included. */
  yaml: string;
  existing?: JsonValue;
  retarget?: Omit<Retarget, "existing" | "localeRoot">;
  rootLocale?: boolean;
  translate?: number;
  json: string;
  yamlOut: string;
};

function run(format: CatalogFormat, text: string, s: Scenario): string {
  const catalog = format.open(text);
  const existing = s.existing === undefined ? undefined : structuredClone(s.existing);
  const localeRoot = s.rootLocale ? rebaseLocaleRoot(catalog.data, existing, "en", "ar") : null;
  const target = catalog.retarget({ ...s.retarget, localeRoot, existing });
  const pending = diffForSync(target.source, target.output, "missing-only");
  const done = s.translate ?? pending.length;
  for (const p of pending.slice(0, done)) p.set(`[ar] ${p.source}`);
  for (const p of pending.slice(done).reverse()) target.revertLeaf(p.path);
  return target.serialize();
}

const scenarios: Scenario[] = [
  {
    name: "translates every leaf in place",
    source: { title: "Title", nav: { home: "Home" } },
    yaml: "# Strings\ntitle: Title\nnav:\n  home: 'Home' # link\n",
    json: '{\n  "title": "[ar] Title",\n  "nav": {\n    "home": "[ar] Home"\n  }\n}\n',
    yamlOut: "# Strings\ntitle: \"[ar] Title\"\nnav:\n  home: '[ar] Home' # link\n",
  },
  {
    name: "renames a locale root in place",
    source: { en: { title: "Title" } },
    yaml: "# top\nen:\n  # note\n  title: Title\n",
    rootLocale: true,
    json: '{\n  "ar": {\n    "title": "[ar] Title"\n  }\n}\n',
    yamlOut: "# top\nar:\n  # note\n  title: \"[ar] Title\"\n",
  },
  {
    name: "regenerates a plural group where it was, keeping the comment above it once",
    source: { title: "Hi", item_one: "{{count}} item", item_other: "{{count}} items", end: "Bye" },
    yaml: "title: Hi\n# Item counts\nitem_one: \"{{count}} item\" # singular\nitem_other: \"{{count}} items\"\nend: Bye\n",
    retarget: { plurals: { sourceLang: "en", targetLang: "ja" } },
    json: '{\n  "title": "[ar] Hi",\n  "item_other": "[ar] {{count}} items",\n  "end": "[ar] Bye"\n}\n',
    yamlOut: "title: \"[ar] Hi\"\n# Item counts\nitem_other: \"[ar] {{count}} items\"\nend: \"[ar] Bye\"\n",
  },
  {
    name: "an abort on a locale-rooted plural catalog drops the unreached forms",
    source: { en: { title: "Title", item_one: "{{count}} item", item_other: "{{count}} items", footer: "Footer" } },
    yaml: "en:\n  title: Title\n  # Item count\n  item_one: \"{{count}} item\"\n  item_other: \"{{count}} items\"\n  footer: Footer\n",
    rootLocale: true,
    retarget: { plurals: { sourceLang: "en", targetLang: "ar" } },
    translate: 3,
    json: '{\n  "ar": {\n    "title": "[ar] Title",\n    "item_zero": "[ar] {{count}} items",\n    "item_one": "[ar] {{count}} item"\n  }\n}\n',
    yamlOut: "ar:\n  title: \"[ar] Title\"\n  # Item count\n  item_zero: \"[ar] {{count}} items\"\n  item_one: \"[ar] {{count}} item\"\n",
  },
  {
    name: "an abort keeps an existing value, null included, in its place",
    source: { a: "One", c: "Three", b: "Two" },
    yaml: "a: One\nc: Three\nb: Two\n",
    existing: { b: "Old", c: null },
    translate: 1,
    json: '{\n  "b": "Old",\n  "c": null,\n  "a": "[ar] One"\n}\n',
    yamlOut: "a: \"[ar] One\"\nc: null\nb: Old\n",
  },
  {
    // #159: removing the null items from the document shifted the source item
    // `Three` onto the data's first null, writing it as source text.
    name: "an abort keeps the existing nulls of a list in place",
    source: { list: ["One", "Two", "Three"] },
    yaml: "list:\n  - One\n  - Two\n  - Three\n",
    existing: { list: [null, null, "Tres"] },
    translate: 0,
    json: '{\n  "list": [\n    null,\n    null,\n    "Tres"\n  ]\n}\n',
    yamlOut: "list:\n  - null\n  - null\n  - Tres\n",
  },
  {
    name: "keeps target-only keys (YAML appends them)",
    source: { a: "One" },
    yaml: "a: One\n",
    existing: { legacy: "kept" },
    json: '{\n  "legacy": "kept",\n  "a": "[ar] One"\n}\n',
    yamlOut: "a: \"[ar] One\"\nlegacy: kept\n",
  },
  {
    // #160: the target's non-string values win, as in JSON.
    name: "keeps the target's non-string values",
    source: { title: "Hello", count: 5 },
    yaml: "title: Hello\ncount: 5\n",
    existing: { count: 7 },
    json: '{\n  "count": 7,\n  "title": "[ar] Hello"\n}\n',
    yamlOut: "title: \"[ar] Hello\"\ncount: 7\n",
  },
  {
    // #160: a non-string source value the target lacks is not sync'd, as in JSON.
    name: "leaves out non-string source values the target lacks",
    source: { title: "Hello", limit: 10, flags: { beta: true }, empty: {} },
    yaml: "title: Hello\n# Rate limit\nlimit: 10\nflags:\n  beta: true\nempty: {}\n",
    existing: { title: "Bonjour" },
    json: '{\n  "title": "Bonjour"\n}\n',
    yamlOut: "title: Bonjour\n",
  },
  {
    name: "keeps the source document's style for equal non-string values",
    source: { size: 16, on: true, none: null },
    yaml: "size: 0x10 # hex\non: true\nnone: ~\n",
    existing: { size: 16, on: true, none: null },
    json: '{\n  "size": 16,\n  "on": true,\n  "none": null\n}\n',
    yamlOut: "size: 0x10 # hex\non: true\nnone: ~\n",
  },
];

describe("catalog formats", () => {
  for (const s of scenarios) {
    test(`json: ${s.name}`, () => {
      expect(run(jsonFormat, JSON.stringify(s.source, null, 2) + "\n", s)).toBe(s.json);
    });
    test(`yaml: ${s.name}`, () => {
      expect(yamlFormat.read(s.yaml)).toEqual(s.source);
      const out = run(yamlFormat, s.yaml, s);
      expect(out).toBe(s.yamlOut);
      // Both formats write the same data; only the layout differs.
      expect(yamlFormat.read(out)).toEqual(JSON.parse(s.json));
    });
  }

  test("an empty or comments-only YAML source still writes the data", () => {
    const target = yamlFormat.open("# nothing here yet\n").retarget({ existing: { legacy: "kept" } });
    expect(target.serialize()).toBe("# nothing here yet\n\nlegacy: kept\n");
  });

  const formats: [CatalogFormat, string][] = [[jsonFormat, '{"a":"One"}'], [yamlFormat, "a: One\n"]];

  test("the written text parses back to the output data", () => {
    for (const [format, text] of formats) {
      const target = format.open(text).retarget({});
      (target.output as { a: string }).a = "Uno";
      expect(format.read(target.serialize())).toEqual(target.output);
    }
  });

  test("a source catalog is retargeted only once", () => {
    for (const [format, text] of formats) {
      const catalog = format.open(text);
      catalog.retarget({});
      expect(() => catalog.retarget({})).toThrow(/only once/);
    }
  });

  test("revertLeaf without an existing target removes the leaf and the containers it empties", () => {
    const target = yamlFormat.open("a: One\nnest:\n  b: Two\n").retarget({});
    (target.output as { a: string }).a = "[ar] One";
    target.revertLeaf(["nest", "b"]);
    expect(target.output).toEqual({ a: "[ar] One" });
    expect(target.serialize()).toBe("a: \"[ar] One\"\n");
  });
});
