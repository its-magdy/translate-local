import { describe, test, expect } from "bun:test";
import {
  parseICU,
  printICU,
  translateICU,
  escapeLiteral,
  planPluralKeys,
  pluralCategories,
  pluralSample,
  sampleRegex,
  type UnitTranslator,
} from "../icu";

// Location info differs between the source and the reprint; compare structure only.
function shape(message: string): unknown {
  return JSON.parse(JSON.stringify(parseICU(message), (k, v) => (k === "location" ? undefined : v)));
}

// Uppercases words, leaves __TLPH_N__ sentinels alone, and honors the check like the real runner.
function fakeTranslator(transform: (s: string) => string = (s) => s.replace(/[a-z]+/g, (w) => w.toUpperCase())) {
  const calls: string[] = [];
  const translate: UnitTranslator = async (masked, check) => {
    calls.push(masked);
    const out = transform(masked);
    const reason = check(out);
    if (reason !== null) throw new Error(reason);
    return out;
  };
  return { calls, translate };
}

describe("printICU round-trip", () => {
  const canonical = [
    "Hello {name}!",
    "{count, plural, =0 {No items} one {# item} other {# items}}",
    "{n, plural, offset:1 =0 {Nobody} =1 {{host}} one {{host} and # other} other {{host} and # others}}",
    "{gender, select, female {{n, plural, one {She has # cat} other {She has # cats}}} other {{n, plural, one {They have # cat} other {They have # cats}}}}",
    "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
    "Price: {p, number, ::currency/EUR} on {d, date, short} at {t, time, ::Hm}",
    "It's {name}'s turn",
    "Use '{'braces'}' and l''{x}",
    "{n, plural, other {# is '#'}}",
    "{n, plural, other {it's #'s turn}}",
    "<b>Bold</b> {n} <a href=\"/x\">link</a>",
    "{a, select, x {X} other {{b, select, y {Y} other {Z}}}}",
  ];

  for (const msg of canonical) {
    test(`prints canonical input unchanged: ${msg}`, async () => {
      expect(await printICU(msg)).toBe(msg);
    });
  }

  test("normalizes compact spacing without changing structure", async () => {
    const src = "{n,plural,one{# item}other{# items}}";
    const out = await printICU(src);
    expect(out).toBe("{n, plural, one {# item} other {# items}}");
    expect(shape(out)).toEqual(shape(src));
  });

  test("keeps number/date style text verbatim", async () => {
    const src = "{v,number,percent} {d , date , ::yyyyMMMd}";
    expect(await printICU(src)).toBe(src);
  });

  test("throws on malformed ICU", async () => {
    await expect(printICU("{n, plural, one {x}")).rejects.toThrow();
    await expect(printICU("{n, plural, one {x}}")).rejects.toThrow(); // no `other`
  });
});

describe("escapeLiteral", () => {
  test("plain text is unchanged", () => {
    expect(escapeLiteral("Hello world", false, true)).toBe("Hello world");
  });

  test("apostrophe before ordinary text stays single", () => {
    expect(escapeLiteral("it's", false, true)).toBe("it's");
  });

  test("apostrophe before a following argument is doubled", () => {
    expect(escapeLiteral("l'", false, false)).toBe("l''");
  });

  test("trailing apostrophe at end of message stays single", () => {
    expect(escapeLiteral("les élèves'", false, true)).toBe("les élèves'");
  });

  test("braces are quoted", () => {
    expect(escapeLiteral("a {b} c", false, true)).toBe("a '{'b'}' c");
  });

  test("apostrophes next to quoted braces are doubled inside the quote", () => {
    expect(escapeLiteral("{'", false, true)).toBe("'{'''");
  });

  test("# is quoted only inside plural", () => {
    expect(escapeLiteral("#1", true, true)).toBe("'#'1");
    expect(escapeLiteral("#1", false, true)).toBe("#1");
  });

  test("double apostrophe survives", () => {
    expect(escapeLiteral("''", false, true)).toBe("'''");
  });

  test("escaped literals re-parse to the same text", () => {
    for (const text of ["l'", "{'", "a {b} c", "it's", "''", "'<b>'", "x'}'y"]) {
      const msg = `${escapeLiteral(text, false, false)}{arg}`;
      const ast = parseICU(msg);
      expect(ast[0]).toMatchObject({ type: 0, value: text });
    }
  });
});

describe("plural helpers", () => {
  test("pluralCategories is canonical-ordered and null for a locale Intl falls back on", () => {
    expect(pluralCategories("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(pluralCategories("en", "ordinal")).toEqual(["one", "two", "few", "other"]);
    expect(pluralCategories("xx")).toBeNull();
    expect(pluralCategories("not a tag!")).toBeNull();
  });

  test("pluralSample marks single-valued categories exact", () => {
    expect(pluralSample("ar", "two")).toEqual({ value: 2, exact: true });
    expect(pluralSample("ar", "few")).toEqual({ value: 3, exact: false });
    expect(pluralSample("xx", "one")).toBeNull();
  });

  test("pluralSample gives no hint for fraction-only categories", () => {
    // ru/pl `other` holds only decimals; "1.5 files" produced nonsense translations.
    expect(pluralSample("ru", "other")).toBeNull();
    expect(pluralSample("pl", "other")).toBeNull();
  });

  test("tl resolves through fil", () => {
    expect(pluralCategories("tl")).toEqual(["one", "other"]);
    expect(pluralSample("tl", "one")).not.toBeNull();
  });

  test("sampleRegex matches grouped forms, never a sentinel index", () => {
    expect("1 000 000 de fichiers".match(sampleRegex(1000000, "fr"))).toEqual(["1 000 000"]);
    expect("__TLPH_3__ and 3 more".match(sampleRegex(3, "en"))).toEqual(["3"]);
    expect("__TLPH_1__".match(sampleRegex(1, "en"))).toBeNull();
    expect("mp3".match(sampleRegex(3, "en"))).toBeNull();
  });

  test("sampleRegex matches a number squeezed between sentinels", () => {
    expect("__TLPH_0__1__TLPH_2__ new".match(sampleRegex(1, "en"))).toEqual(["1"]);
    expect("__TLPH_0__と5人".match(sampleRegex(5, "ja"))).toEqual(["5"]);
  });

  test("sampleRegex matches any Unicode digit system", () => {
    expect("٣ ملفات".match(sampleRegex(3, "en"))).toEqual(["٣"]);
    expect("۳ فایل".match(sampleRegex(3, "ar"))).toEqual(["۳"]);
    expect("३ फ़ाइलें".match(sampleRegex(3, "en"))).toEqual(["३"]);
    expect("١١ ملفًا".match(sampleRegex(11, "en"))).toEqual(["١١"]);
  });
});

describe("planPluralKeys", () => {
  const keys = (plan: { key: string }[]) => plan.map((p) => p.key);

  test("en → ar adds zero/two/few/many", () => {
    const plan = planPluralKeys(["one", "other"], "ar", "cardinal");
    expect(keys(plan)).toEqual(["zero", "one", "two", "few", "many", "other"]);
    expect(plan.filter((p) => p.derived).map((p) => [p.key, p.sample])).toEqual([
      ["zero", 0], ["two", 2], ["few", 3], ["many", 11],
    ]);
  });

  test("exact =N branches are kept and cover single-number categories", () => {
    const plan = planPluralKeys(["=0", "one", "other"], "ar", "cardinal");
    expect(keys(plan)).toEqual(["=0", "one", "two", "few", "many", "other"]);
  });

  test("en → ja drops one but keeps =N and other", () => {
    expect(keys(planPluralKeys(["=0", "one", "other"], "ja", "cardinal"))).toEqual(["=0", "other"]);
  });

  test("ordinal categories use the ordinal rules", () => {
    expect(keys(planPluralKeys(["one", "two", "few", "other"], "ar", "ordinal"))).toEqual(["other"]);
  });

  test("unknown locale leaves the keys untouched", () => {
    expect(keys(planPluralKeys(["one", "other"], "xx", "cardinal"))).toEqual(["one", "other"]);
  });

  test("doesn't add a category that starts at a million, but keeps it from the source", () => {
    expect(keys(planPluralKeys(["one", "other"], "fr", "cardinal"))).toEqual(["one", "other"]);
    expect(keys(planPluralKeys(["one", "many", "other"], "fr", "cardinal"))).toEqual(["one", "many", "other"]);
    expect(keys(planPluralKeys(["one", "other"], "es", "cardinal"))).toEqual(["one", "other"]);
  });

  test("fraction-only categories get no sample", () => {
    const plan = planPluralKeys(["one", "other"], "ru", "cardinal");
    expect(plan.find((p) => p.key === "other")?.sample).toBeUndefined();
  });

  test("samples avoid numbers already written in the branch", () => {
    // ru many = 0, 5–20, …; the derived `many` reads the `other` text.
    const literals = (key: string) => new Set(key === "other" ? [5] : key === "one" ? [1] : []);
    const plan = planPluralKeys(["one", "other"], "ru", "cardinal", literals);
    expect(plan.find((p) => p.key === "many")?.sample).toBe(6);
    expect(plan.find((p) => p.key === "one")?.sample).toBe(21);
    // en `one` is only 1 — no collision-free sample, so no hint at all.
    const en = planPluralKeys(["one", "other"], "en", "cardinal", literals);
    expect(en.find((p) => p.key === "one")?.sample).toBeUndefined();
  });
});

describe("translateICU", () => {
  test("translates each plural branch as a whole message", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{count, plural, one {# item} other {# items}}", "en", translate);
    expect(out).toBe("{count, plural, one {# ITEM} other {# ITEMS}}");
    expect(calls).toEqual(["1 item", "2 items"]); // count slots carry a sample number
  });

  test("masks a nested plural inside the surrounding sentence", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU(
      "You have {n, plural, one {# message} other {# messages}} from {name}",
      "en",
      translate,
    );
    expect(out).toBe("YOU HAVE {n, plural, one {# MESSAGE} other {# MESSAGES}} FROM {name}");
    expect(calls).toContain("You have __TLPH_0__ from __TLPH_1__");
  });

  test("nested plural inside select keeps selectors, # and argument names", async () => {
    const { translate } = fakeTranslator();
    const src = "{gender, select, female {{n, plural, one {She has # cat} other {She has # cats}}} other {They have {n, number} cats}}";
    const out = await translateICU(src, "en", translate);
    expect(out).toBe("{gender, select, female {{n, plural, one {SHE HAS # CAT} other {SHE HAS # CATS}}} other {THEY HAVE {n, number} CATS}}");
  });

  test("keeps offset and =N branches", async () => {
    const { translate } = fakeTranslator();
    const out = await translateICU("{n, plural, offset:1 =0 {nobody} =1 {just {host}} other {{host} and # others}}", "ja", translate);
    expect(out).toBe("{n, plural, offset:1 =0 {NOBODY} =1 {JUST {host}} other {{host} AND # OTHERS}}");
  });

  test("adds target categories via a sample number", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{n, plural, one {# file} other {# files}}", "ru", translate);
    expect(out).toBe("{n, plural, one {# FILE} few {# FILES} many {# FILES} other {# FILES}}");
    expect(calls).toContain("2 files");
    expect(calls).toContain("5 files");
    // ru `other` is fraction-only: translated plainly, never as "1.5 files".
    expect(calls).toContain("__TLPH_0__ files");
    expect(calls.some((c) => c.includes("1.5"))).toBe(false);
  });

  test("a literal number in the branch never becomes #", async () => {
    // If the sample were 5 and the model dropped it, the literal 5 would be mapped to `#`.
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{n, plural, one {# file in 1 folder} other {# files in 5 folders}}", "ru", translate);
    expect(calls).toContain("6 files in 5 folders");
    expect(calls).toContain("21 file in 1 folder");
    expect(out).toContain("many {# FILES IN 5 FOLDERS}");
  });

  test("no collision-free sample falls back to the sentinel route", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{n, plural, one {# file in 1 folder} other {# files}}", "en", translate);
    expect(calls).toContain("__TLPH_0__ file in 1 folder");
    expect(out).toBe("{n, plural, one {# FILE IN 1 FOLDER} other {# FILES}}");
  });

  test("maps back a sample written in Arabic-Indic digits or glued to a sentinel", async () => {
    const { translate } = fakeTranslator((s) =>
      s === "3 files" ? "٣ ملفات" : s === "__TLPH_0__ and 2 guests" ? "__TLPH_0__2 GUESTS" : s.toUpperCase());
    const ar = await translateICU("{n, plural, one {# file} other {# files}}", "ar", translate);
    expect(ar).toContain("few {# ملفات}");
    const en = await translateICU("{n, plural, one {{host} and # guest} other {{host} and # guests}}", "en", translate);
    expect(en).toContain("other {{host}# GUESTS}");
  });

  test("falls back to the translated other branch when the sample number is lost", async () => {
    const { translate } = fakeTranslator((s) => s.replace(/\b\d+\b/g, "some").replace(/[a-z]+/g, (w) => w.toUpperCase()));
    const out = await translateICU("{n, plural, one {# file} other {# files}}", "ru", translate);
    expect(out).toBe("{n, plural, one {# FILE} few {# FILES} many {# FILES} other {# FILES}}");
  });

  test("escapes apostrophes and braces the model introduces", async () => {
    const { translate } = fakeTranslator((s) => s.replace("Delete ", "Supprimer l'").replace("now", "now {}"));
    const out = await translateICU("Delete {item} now", "fr", translate);
    expect(out).toBe("Supprimer l''{item} now '{}'");
    expect(parseICU(out)[0]).toMatchObject({ value: "Supprimer l'" });
    expect(parseICU(out)[2]).toMatchObject({ value: " now {}" });
  });

  test("rejects a placeholder the model invents", async () => {
    const { translate } = fakeTranslator((s) => s.replace("now", "<i>now</i>"));
    await expect(translateICU("Delete {item} now", "fr", translate)).rejects.toThrow(/extra: \[<i>, <\/i>\]/);
  });

  test("never drops half a tag pair with the number", async () => {
    // Groups are runs of adjacent placeholders: `<b># file</b>` is [<b>, #] and [</b>].
    const dropOne = (s: string) => (/^\S*1\b/.test(s) ? s.replace(/1/, "").toUpperCase() : s.toUpperCase());
    const { calls, translate } = fakeTranslator(dropOne);
    const out = await translateICU("{n, plural, one {<b># file</b>} other {<b># files</b>}}", "en", translate);
    expect(out).toBe("{n, plural, one {<b># FILE</b>} other {<b># FILES</b>}}");
    expect(calls).toContain("__TLPH_0__ file__TLPH_1__"); // sentinel route after the refused drop
  });

  test("a void tag next to the number is never dropped", async () => {
    const dropOne = (s: string) => (s.startsWith("1") ? s.slice(1).toUpperCase() : s.toUpperCase());
    const { translate } = fakeTranslator(dropOne);
    const out = await translateICU("{n, plural, one {#<br/>file} other {#<br/>files}}", "en", translate);
    expect(out).toBe("{n, plural, one {#<br/>FILE} other {#<br/>FILES}}");
  });

  test("a closing tag glued to the number is never dropped with it", async () => {
    // `<b>only #</b> file` groups as [<b>] "only " [#, </b>] " file".
    const { calls, translate } = fakeTranslator((s) => s.replace(/\b1 /, "").toUpperCase());
    const out = await translateICU("{n, plural, one {<b>only #</b> file} other {<b>only #</b> files}}", "en", translate);
    expect(out).toBe("{n, plural, one {<b>ONLY #</b> FILE} other {<b>ONLY #</b> FILES}}");
    expect(calls).toContain("__TLPH_0__only __TLPH_1__ file");
  });

  test("rejects output whose tags no longer parse as rich text", async () => {
    const swap = (s: string) => s.replace("__TLPH_0__here__TLPH_1__", "__TLPH_1__here__TLPH_0__");
    await expect(translateICU("Click <b>here</b>", "fr", fakeTranslator(swap).translate)).rejects.toThrow(/tags/);
    // A quoted (literal) tag must not come back as a real one.
    await expect(translateICU("a '<b>' text", "fr", fakeTranslator().translate)).rejects.toThrow(/tags/);
  });

  test("pipeline errors are never swallowed by a fallback", async () => {
    let calls = 0;
    const translate: UnitTranslator = async () => {
      calls++;
      throw Object.assign(new Error("ollama down"), { pipelineError: new Error("timeout") });
    };
    await expect(translateICU("{n, plural, one {# file} other {# files}}", "ar", translate)).rejects.toThrow("ollama down");
    expect(calls).toBe(1);
  });

  test("preserves branch-edge whitespace", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{n, plural, one { item } other { items}}", "en", translate);
    expect(out).toBe("{n, plural, one { ITEM } other { ITEMS}}");
    expect(calls).toEqual(["item", "items"]);
  });

  test("masks non-ICU placeholders inside literal text", async () => {
    const { calls, translate } = fakeTranslator();
    const out = await translateICU("{n, plural, one {<b>#</b> item} other {<b>#</b> items}}", "en", translate);
    expect(out).toBe("{n, plural, one {<b>#</b> ITEM} other {<b>#</b> ITEMS}}");
    expect(calls[0]).toBe("1 item");
  });

  test("skips units with no letters", async () => {
    const { calls, translate } = fakeTranslator();
    expect(await translateICU("{a}: {b, number}", "fr", translate)).toBe("{a}: {b, number}");
    expect(calls).toEqual([]);
  });

  test("adjacent placeholders share one sentinel", async () => {
    const { calls, translate } = fakeTranslator();
    expect(await translateICU("Click <b>{action}</b> now", "fr", translate)).toBe("CLICK <b>{action}</b> NOW");
    expect(calls).toEqual(["Click __TLPH_0__ now"]);
  });

  test("a single-valued category may drop the number with the markup around it, not other arguments", async () => {
    const { translate } = fakeTranslator((s) => (s.startsWith("1 ") ? "ONE MESSAGE" : s.toUpperCase()));
    expect(await translateICU("{n, plural, one {<b>#</b> message} other {<b>#</b> messages}}", "en", translate))
      .toBe("{n, plural, one {ONE MESSAGE} other {<b>#</b> MESSAGES}}");
    // {n, number} in the group is another argument — dropping it is not allowed, so the sentinel route runs.
    const { calls, translate: t2 } = fakeTranslator((s) => (s.startsWith("1") ? "ONE MESSAGE" : s.toUpperCase()));
    await translateICU("{n, plural, one {#{n, number} message} other {# messages}}", "en", t2);
    expect(calls).toContain("__TLPH_0__ message");
  });

  test("rejects a sample translation that invents another number", async () => {
    const { translate } = fakeTranslator((s) => s.replace("2 guests", "3 guests").toUpperCase());
    const out = await translateICU("{n, plural, one {# guest} other {# guests}}", "en", translate);
    expect(out).toBe("{n, plural, one {# GUEST} other {# GUESTS}}"); // fell back to the sentinel route
  });

  test("a single-valued category may drop the number", async () => {
    const { translate } = fakeTranslator((s) => (s === "2 files" ? "TWO FILES" : s.toUpperCase()));
    const out = await translateICU("{n, plural, one {# file} other {# files}}", "ar", translate);
    expect(out).toContain("two {TWO FILES}");
    expect(out).toContain("few {# FILES}");
  });

  test("dropped placeholder surfaces through the check with the raw token", async () => {
    const { translate } = fakeTranslator((s) => s.replace("__TLPH_0__", ""));
    await expect(
      translateICU("{n, plural, one {{host} has # item} other {{host} has # items}}", "en", translate),
    ).rejects.toThrow(/missing: \[\{host\}\]/);
  });
});
