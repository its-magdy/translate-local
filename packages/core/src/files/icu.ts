// Structure-preserving translation of ICU MessageFormat strings.
//
// The message is parsed with @formatjs/icu-messageformat-parser and rebuilt by
// our own printer. Each "unit" — the top-level message and every plural/select
// branch — is sent to the model as one whole message, with its nested syntax
// (arguments, `#`, nested plural/select) masked as __TLPH_N__ sentinels. Only
// literal text is ever translated; argument names, selectors, offsets and
// number/date styles are re-emitted from the source.
//
// We don't use formatjs's printAST: it re-sorts plural/select keys, compacts
// spacing, and quotes literal `<tag>` text — wrong for messages parsed with
// ignoreTag (and for runtimes that parse tags, it would turn rich-text tags
// into literal text).
import { parse, TYPE, type MessageFormatElement, type PluralElement } from "@formatjs/icu-messageformat-parser";
import { PLACEHOLDER_SENTINEL_PREFIX } from "@translate-local/shared/constants";
import { extract, maskAppend, sentinelFor, sentinelIndices, splitSentinels, type Placeholder } from "./placeholders";

// ignoreTag: tags stay literal text, so the regular placeholder masker protects
// them. captureLocation: simple arguments are re-emitted as their exact source slice.
const PARSE_OPTIONS = { ignoreTag: true, captureLocation: true } as const;

/**
 * Translates `masked` (text with __TLPH_N__ sentinels). `check` returns null
 * when an output is acceptable, otherwise a reason. Implementations retry on
 * rejection and throw when they give up. An error carrying a `pipelineError`
 * property (the model call itself failed) is fatal: no fallback route absorbs it.
 */
export type UnitTranslator = (masked: string, check: (out: string) => string | null) => Promise<string>;

type Ctx = { source: string; targetLang?: string; translate?: UnitTranslator };
// A number substituted for the count (`#`, or the plural's own argument) in one branch.
type Sample = { n: number; arg?: string; allowDrop: boolean };

export function parseICU(message: string): MessageFormatElement[] {
  return parse(message, PARSE_OPTIONS);
}

/** Re-prints `message` through the parser and printer without translating anything. */
export function printICU(message: string): Promise<string> {
  return rebuild(message, { source: message });
}

/**
 * Translates the literal text of an ICU message, keeping its structure. Plural
 * branches are adjusted to the target locale's CLDR categories. Throws when the
 * message doesn't parse, a unit fails to translate, or the result doesn't
 * re-parse with the same arguments.
 */
export function translateICU(message: string, targetLang: string, translate: UnitTranslator): Promise<string> {
  return rebuild(message, { source: message, targetLang, translate });
}

async function rebuild(message: string, ctx: Ctx): Promise<string> {
  const ast = parseICU(message);
  const out = await renderMessage(ast, ctx, false, true);
  let reparsed: MessageFormatElement[];
  try {
    reparsed = parseICU(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`translated ICU message does not parse (${msg}): ${out}`);
  }
  const before = signature(ast);
  const after = signature(reparsed);
  if (before.size !== after.size || [...before].some((s) => !after.has(s))) {
    throw new Error(`translated ICU message changed its arguments: ${out}`);
  }
  // Tags are parsed as literal text above. If the source is also valid rich
  // text (react-intl `<b>…</b>`), the output must be too, with the same tags:
  // a half-dropped pair, reordered tag sentinels, or a quoted `'<b>'` coming
  // back unquoted would otherwise only break at runtime.
  const sourceTags = tagPaths(message);
  if (sourceTags !== null) {
    const outTags = tagPaths(out);
    if (outTags === null || outTags.size !== sourceTags.size || [...sourceTags].some((t) => !outTags.has(t))) {
      throw new Error(`translated ICU message changed its tags: ${out}`);
    }
  }
  return out;
}

// Each tag as its ancestor path ("b", "b>i"), or null when `message` doesn't
// parse with tags enabled. A set, because plural branches come and go.
function tagPaths(message: string): Set<string> | null {
  let ast: MessageFormatElement[];
  try {
    ast = parse(message);
  } catch {
    return null;
  }
  const out = new Set<string>();
  const walk = (els: MessageFormatElement[], path: string) => {
    for (const el of els) {
      if (el.type === TYPE.tag) {
        const p = path ? `${path}>${el.value}` : el.value;
        out.add(p);
        walk(el.children, p);
      } else if (el.type === TYPE.plural || el.type === TYPE.select) {
        for (const opt of Object.values(el.options)) walk(opt.value, path);
      }
    }
  };
  walk(ast, "");
  return out;
}

const isFatal = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { pipelineError?: unknown }).pipelineError !== undefined;

// --- escaping ---------------------------------------------------------------

// An apostrophe before any of these starts a quoted span in formatjs or ICU4J;
// doubling it is always safe because `''` means one apostrophe everywhere.
const QUOTE_TRIGGER = /[{}#|<>']/;

/**
 * Escapes literal text for ICU. `{`/`}` (and `#` directly inside a plural
 * branch) are quoted; an apostrophe is doubled only where it would otherwise
 * open a quote, so ordinary text like "it's" stays readable. `endsMessage` is
 * true when nothing follows the text (end of the top-level message).
 */
export function escapeLiteral(text: string, inPlural: boolean, endsMessage: boolean): string {
  const special = (c: string) => c === "{" || c === "}" || (inPlural && c === "#");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (special(c)) {
      // Quote the whole run; apostrophes inside a quote are doubled.
      let quoted = "";
      while (i < text.length && (special(text[i]) || text[i] === "'")) {
        quoted += text[i] === "'" ? "''" : text[i];
        i++;
      }
      out += `'${quoted}'`;
      continue;
    }
    if (c === "'") {
      const next = i + 1 < text.length ? text[i + 1] : endsMessage ? "" : "{";
      out += next !== "" && QUOTE_TRIGGER.test(next) ? "''" : "'";
    } else {
      out += c;
    }
    i++;
  }
  return out;
}

// --- rendering --------------------------------------------------------------

// One sentinel stands for a run of adjacent placeholders: `<b>#</b>` becomes a
// single token instead of three back-to-back sentinels the model tends to drop.
type Part = { text: string; syntax: boolean; count: boolean };
type Group = Part[];

async function renderMessage(
  els: MessageFormatElement[],
  ctx: Ctx,
  inPlural: boolean,
  isTop: boolean,
  sample?: Sample,
): Promise<string> {
  const groups: Group[] = [];
  let masked = "";
  let inGroup = false;
  const addPart = (part: Part) => {
    if (inGroup) {
      groups[groups.length - 1].push(part);
      return;
    }
    groups.push([part]);
    masked += sentinelFor(groups.length - 1);
    inGroup = true;
  };

  for (const el of els) {
    if (el.type === TYPE.literal) {
      const literalPhs: Placeholder[] = [];
      for (const piece of splitSentinels(maskAppend(el.value, literalPhs))) {
        if (typeof piece === "number") {
          addPart({ text: literalPhs[piece].raw, syntax: false, count: false });
        } else {
          masked += piece;
          inGroup = false;
        }
      }
      continue;
    }
    const count = !!sample && (el.type === TYPE.pound || (el.type === TYPE.argument && el.value === sample.arg));
    addPart({ text: await renderElement(el, ctx), syntax: true, count });
  }

  const hasText = splitSentinels(masked).some((part) => typeof part === "string" && /\p{L}/u.test(part));
  const translated = ctx.translate && hasText
    ? await translateUnit(masked, ctx.translate, groups, ctx.targetLang ?? "", sample)
    : masked;

  // Merge adjacent text before escaping so each apostrophe sees its true next character.
  let out = "";
  let text = "";
  for (const piece of splitSentinels(translated)) {
    for (const part of typeof piece === "string" ? [{ text: piece, syntax: false }] : groups[piece]) {
      if (!part.syntax) {
        text += part.text;
        continue;
      }
      out += escapeLiteral(text, inPlural, false) + part.text;
      text = "";
    }
  }
  return out + escapeLiteral(text, inPlural, isTop);
}

async function renderElement(el: MessageFormatElement, ctx: Ctx): Promise<string> {
  switch (el.type) {
    case TYPE.pound:
      return "#";
    case TYPE.select: {
      const parts: string[] = [];
      for (const [key, opt] of Object.entries(el.options)) {
        parts.push(`${key} {${await renderMessage(opt.value, ctx, false, false)}}`);
      }
      return `{${el.value}, select, ${parts.join(" ")}}`;
    }
    case TYPE.plural:
      return renderPlural(el, ctx);
    default:
      // argument / number / date / time: emit the source text verbatim.
      return ctx.source.slice(el.location!.start.offset, el.location!.end.offset);
  }
}

// Plural branches are translated with a representative number in place of `#`
// ("5 files", not "__TLPH_0__ files"): the model inflects the noun for that
// number, and a leading sentinel in a short phrase is the case it most often
// drops. If the number doesn't come back, a kept branch falls back to the
// sentinel route and a derived branch to a copy of the translated `other`.
async function renderPlural(el: PluralElement, ctx: Ctx): Promise<string> {
  const type: PluralType = el.pluralType === "ordinal" ? "ordinal" : "cardinal";
  const keys = Object.keys(el.options);
  // Numbers already written in a branch can't double as its sample: if the
  // model dropped the sample, the literal would be mapped back to `#`.
  const literals = (key: string) => new Set(
    el.options[key].value.flatMap((e) => (e.type === TYPE.literal ? asciiDigits(e.value).match(/\d+/g) ?? [] : []).map(Number)),
  );
  const plan = ctx.translate && ctx.targetLang
    ? planPluralKeys(keys, ctx.targetLang, type, literals)
    : keys.map((key): PluralPlanEntry => ({ key, derived: false }));

  // `#` is the value minus the offset; the raw argument only equals it without one.
  const countArg = el.offset ? undefined : el.value;
  const hasCount = (value: MessageFormatElement[]) =>
    value.some((e) => e.type === TYPE.pound || (e.type === TYPE.argument && e.value === countArg));
  const sampleFor = (p: PluralPlanEntry): Sample | undefined => {
    if (!ctx.translate) return undefined;
    if (p.key.startsWith("=")) {
      const n = Number(p.key.slice(1)) - el.offset;
      return literals(p.key).has(n) ? undefined : { n, arg: countArg, allowDrop: true };
    }
    return p.sample === undefined ? undefined : { n: p.sample, arg: countArg, allowDrop: !!p.exact };
  };
  const render = async (value: MessageFormatElement[], sample: Sample | undefined, fallback: () => Promise<string>) => {
    if (!sample || !hasCount(value)) return fallback();
    try {
      return await renderMessage(value, ctx, true, false, sample);
    } catch (err) {
      if (isFatal(err)) throw err;
      return fallback();
    }
  };

  const bodies = new Map<string, string>();
  for (const p of plan) {
    if (p.derived) continue;
    const value = el.options[p.key].value;
    bodies.set(p.key, await render(value, sampleFor(p), () => renderMessage(value, ctx, true, false)));
  }
  const otherBody = bodies.get("other")!;
  const parts: string[] = [];
  for (const p of plan) {
    const body = bodies.get(p.key) ?? (await render(el.options.other.value, sampleFor(p), async () => otherBody));
    parts.push(`${p.key} {${body}}`);
  }
  const keyword = type === "ordinal" ? "selectordinal" : "plural";
  const offset = el.offset ? `offset:${el.offset} ` : "";
  return `{${el.value}, ${keyword}, ${offset}${parts.join(" ")}}`;
}

async function translateUnit(
  masked: string,
  translate: UnitTranslator,
  groups: Group[],
  targetLang: string,
  sample: Sample | undefined,
): Promise<string> {
  // The pipeline trims model output; keep the unit's edge whitespace ourselves.
  const lead = masked.match(/^\s*/)![0];
  const trail = masked.slice(lead.length).match(/\s*$/)![0];
  let core = masked.slice(lead.length, masked.length - trail.length);

  const sampleGroups = sample ? sentinelIndices(core).filter((i) => groups[i].some((p) => p.count)) : [];
  let sampleRe: RegExp | undefined;
  if (sample && sampleGroups.length > 0) {
    sampleRe = sampleRegex(sample.n, targetLang);
    if (core.match(sampleRe)) throw new Error("sample number already in text");
    for (const i of sampleGroups) core = core.replace(sentinelFor(i), String(sample.n));
  }

  const expected = sentinelIndices(core);
  const placeholdersIn = (s: string) => extract(textOf(s)).map((p) => p.raw);
  const before = placeholdersIn(core);
  let out = await translate(core, (candidate) =>
    diffSentinels(expected, sentinelIndices(candidate), groups)
    // Placeholder-shaped text outside the sentinels: the model invented a tag
    // or `{name}` (or dropped one that was literal text).
    ?? diffRaw(before, placeholdersIn(candidate)));

  if (sampleRe) {
    const found = (out.match(sampleRe) ?? []).length;
    // A category with a single value ("one" = 1, Arabic "two" = 2, `=N`) may
    // legitimately lose the number ("رسالتان" = two messages) — along with
    // markup that fully encloses it (`<b>#</b>`), but never half a tag pair
    // or another argument.
    const mayDrop = sample!.allowDrop && sampleGroups.every((i) => droppableGroup(groups[i]));
    if (found !== sampleGroups.length && !(found === 0 && mayDrop)) throw new Error("sample number lost");
    let k = 0;
    out = out.replace(sampleRe, () => sentinelFor(sampleGroups[k++]));
    // The model sometimes does arithmetic on the sample ("{host} and 11 others"
    // → "12 guests"); a number that wasn't in the source would be hard-coded.
    const numbers = (s: string) => asciiDigits(textOf(s)).match(/\p{Nd}+/gu) ?? [];
    const known = new Set(numbers(masked));
    if (numbers(out).some((n) => !known.has(n))) throw new Error("unexpected number in sample translation");
  }
  return lead + out + trail;
}

const textOf = (masked: string): string =>
  splitSentinels(masked).filter((part) => typeof part === "string").join(" ");

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// True when a placeholder group is only the count, or the count fully enclosed
// by tags that open and close around it: [#], [<b>, #, </b>]. Groups are runs of
// adjacent placeholders, not balanced markup — `<b># file</b>` groups as
// [<b>, #] and [</b>] — so anything else must keep its sentinel.
function droppableGroup(group: Group): boolean {
  const stack: string[] = [];
  for (const p of group) {
    if (p.count) {
      if (group.length > 1 && stack.length === 0) return false;
      continue;
    }
    const tag = p.syntax ? null : /^<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>$/.exec(p.text);
    if (!tag || tag[3] === "/" || VOID_TAGS.has(tag[2].toLowerCase())) return false;
    if (tag[1] !== "/") stack.push(tag[2]);
    else if (stack.pop() !== tag[2]) return false;
  }
  return stack.length === 0;
}

function diffRaw(expected: string[], actual: string[]): string | null {
  const counts = new Map<string, number>();
  for (const r of expected) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const r of actual) counts.set(r, (counts.get(r) ?? 0) - 1);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [r, n] of counts) for (let k = 0; k < Math.abs(n); k++) (n > 0 ? missing : extra).push(r);
  if (missing.length === 0 && extra.length === 0) return null;
  return `missing: [${missing.join(", ")}], extra: [${extra.join(", ")}]`;
}

function diffSentinels(expected: number[], actual: number[], groups: Group[]): string | null {
  const counts = new Map<number, number>();
  for (const i of expected) counts.set(i, (counts.get(i) ?? 0) + 1);
  for (const i of actual) counts.set(i, (counts.get(i) ?? 0) - 1);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [i, n] of counts) {
    const raw = groups[i]?.map((p) => p.text).join("") ?? sentinelFor(i);
    for (let k = 0; k < Math.abs(n); k++) (n > 0 ? missing : extra).push(raw);
  }
  if (missing.length === 0 && extra.length === 0) return null;
  return `missing: [${missing.join(", ")}], extra: [${extra.join(", ")}]`;
}

// Argument names and types, select keys, and plural type/offset/exact keys.
// Plural category keys are excluded: they change with the target locale.
function signature(els: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of els) {
    switch (el.type) {
      case TYPE.literal:
      case TYPE.pound:
        break;
      case TYPE.select:
        out.add(`select:${el.value}:${Object.keys(el.options).sort().join(",")}`);
        for (const opt of Object.values(el.options)) signature(opt.value, out);
        break;
      case TYPE.plural: {
        const exact = Object.keys(el.options).filter((k) => k.startsWith("=")).sort();
        out.add(`plural:${el.value}:${el.pluralType}:${el.offset}:${exact.join(",")}`);
        for (const opt of Object.values(el.options)) signature(opt.value, out);
        break;
      }
      case TYPE.tag:
        out.add(`tag:${el.value}`);
        signature(el.children, out);
        break;
      default:
        out.add(`${TYPE[el.type]}:${el.value}`);
    }
  }
  return out;
}

// --- plural categories ------------------------------------------------------
//
// Same shape and names as files/plurals.ts on the i18next plural-regeneration
// branch (PR #56), so the two can be folded into one module once both land.

export type PluralType = "cardinal" | "ordinal";
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

// Candidate samples: positive integers first (most natural in a sentence), then
// 0. Two multiples of a million so French `many` isn't mistaken for
// single-valued. No decimals: a fraction-only category (ru/pl `other`) gets no
// sample — "1.5 files" made the model write nonsense ("each 1.5 units in size").
const SAMPLES: readonly number[] = [
  ...Array.from({ length: 200 }, (_, i) => i + 1),
  1000, 10000, 100000, 1000000, 2000000,
  0,
];
// Only used to tell whether a category with one integer also holds fractions.
const FRACTION_PROBES: readonly number[] = [0.5, 1.5, 2.5];

const language = (tag: string): string => tag.split("-")[0].toLowerCase();

/**
 * Intl.PluralRules for `lang`, or null when the runtime cannot resolve it. An
 * unknown-but-well-formed tag ("xx") silently falls back to the runtime's
 * default locale; that is detected and rejected rather than guessed at.
 */
export function pluralRules(lang: string, type: PluralType = "cardinal"): Intl.PluralRules | null {
  try {
    // Bun's ICU knows Tagalog only by its macrolanguage-successor tag `fil`.
    const requested = Intl.getCanonicalLocales(lang.replace(/^tl(?=$|[-_])/i, "fil"))[0];
    const rules = new Intl.PluralRules(requested, { type });
    if (language(rules.resolvedOptions().locale) !== language(requested)) return null;
    return rules;
  } catch {
    return null;
  }
}

/** The locale's plural categories in canonical CLDR order (zero → other), or null if unresolvable. */
export function pluralCategories(lang: string, type: PluralType = "cardinal"): PluralCategory[] | null {
  const rules = pluralRules(lang, type);
  if (!rules) return null;
  // resolvedOptions() order is engine-dependent; normalize it.
  const used = new Set(rules.resolvedOptions().pluralCategories);
  return PLURAL_CATEGORIES.filter((c) => used.has(c));
}

/**
 * A representative integer for `category` in `lang`, or null when the category
 * holds no integer (fraction-only categories are translated without a hint).
 * `exact` is true when the category holds only that one number (Arabic `two`
 * is 2 and nothing else), so a translation may spell the number out or drop it
 * without changing meaning. `prefer` picks the first value it accepts, if the
 * category has one.
 */
export function pluralSample(
  lang: string,
  category: PluralCategory,
  type: PluralType = "cardinal",
  prefer?: (n: number) => boolean,
): { value: number; exact: boolean } | null {
  const rules = pluralRules(lang, type);
  if (!rules) return null;
  const hits = SAMPLES.filter((n) => rules.select(n) === category);
  if (hits.length === 0) return null;
  const value = (prefer && hits.find(prefer)) ?? hits[0];
  const exact = hits.length === 1 && !FRACTION_PROBES.some((n) => rules.select(n) === category);
  return { value, exact };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Digit-group separators models write in large numbers: "1,000,000",
// "1.000.000", "1 000 000" (plain, no-break, or narrow no-break space), "1'000'000".
const GROUP_SEP = "[ ,.'’\\u00a0\\u202f]?";

// Decimal digit systems a model may answer in (Arabic-Indic ٣, Persian ۳, Devanagari ३, …).
const DIGIT_FORMATS: Intl.NumberFormat[] = [
  "latn", "arab", "arabext", "beng", "deva", "fullwide", "gujr", "guru", "khmr",
  "knda", "laoo", "mlym", "mymr", "orya", "tamldec", "telu", "thai", "tibt",
].flatMap((nu) => {
  try {
    return [new Intl.NumberFormat(`en-u-nu-${nu}`, { useGrouping: false, maximumFractionDigits: 20 })];
  } catch {
    return [];
  }
});
const DIGIT_VALUES = new Map<string, string>(
  DIGIT_FORMATS.flatMap((f) => Array.from({ length: 10 }, (_, d) => [f.format(d), String(d)] as [string, string])),
);

/** Rewrites every known decimal digit as its ASCII digit. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => DIGIT_VALUES.get(c) ?? c);
}

const SENTINEL_INDEX = `${escapeRe(PLACEHOLDER_SENTINEL_PREFIX)}\\p{Nd}*`;

/**
 * Global regex matching `value` as a whole number in model output, in any
 * decimal digit system ("3", "٣", "۳") or the way `lang` formats it ("1,5"),
 * with or without digit grouping ("1 000 000").
 */
export function sampleRegex(value: number, lang: string): RegExp {
  const forms = new Set([String(value), ...DIGIT_FORMATS.map((f) => f.format(value))]);
  try {
    forms.add(new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 20 }).format(value));
  } catch {
    // Unknown locale — the digit-system forms are still matched.
  }
  const grouped = (digits: string[]) =>
    digits.map((d, i) => (i > 0 && (digits.length - i) % 3 === 0 ? GROUP_SEP : "") + escapeRe(d)).join("");
  const alt = [...forms]
    .map((f) => (/^\p{Nd}{4,}$/u.test(f) ? grouped([...f]) : escapeRe(f)))
    .join("|");
  // Not preceded by a digit, separator or ASCII letter ("mp3"), and not the
  // index of a `__TLPH_1__` sentinel — but a number glued to a sentinel
  // (`__TLPH_0__1__TLPH_2__`, i.e. `<b>#</b>`) still matches. A trailing
  // suffix is allowed: ordinals ("1st", "2e") attach letters to the number.
  return new RegExp(`(?<![\\p{Nd}.,٫A-Za-z]|${SENTINEL_INDEX})(?:${alt})(?![\\p{Nd}]|[.,٫]\\p{Nd})`, "gu");
}

export type PluralPlanEntry = { key: string; derived: boolean; sample?: number; exact?: boolean };

/**
 * ICU plural keys for the target locale: every `=N` key (source order), then
 * the target's CLDR categories in canonical order. Categories the source lacks
 * are marked `derived` (built from `other`); a single-valued one already
 * covered by an `=N` key is left out. Categories the target doesn't use are
 * dropped; `other` always stays. Each category carries a representative
 * `sample` and whether it is `exact` (single-valued). The sample avoids
 * `literals(sourceKey)` — numbers already written in the branch it is built
 * from (`other` for a derived category); with no such number there is none.
 * An unknown locale leaves the keys unchanged.
 */
export function planPluralKeys(
  sourceKeys: string[],
  lang: string,
  type: PluralType,
  literals: (sourceKey: string) => ReadonlySet<number> = () => new Set(),
): PluralPlanEntry[] {
  const target = pluralCategories(lang, type);
  if (!target) return sourceKeys.map((key) => ({ key, derived: false }));
  const exactKeys = sourceKeys.filter((k) => k.startsWith("="));
  const plan: PluralPlanEntry[] = exactKeys.map((key) => ({ key, derived: false }));
  for (const cat of PLURAL_CATEGORIES) {
    if (cat !== "other" && !target.includes(cat)) continue;
    const derived = !sourceKeys.includes(cat);
    // Prefer 1 for "one" and ≥ 2 otherwise: 0 often gets special wording ("no files").
    const natural = (n: number) => (cat === "one" ? n >= 1 : n >= 2);
    const typical = pluralSample(lang, cat, type, natural);
    if (derived && typical?.exact && exactKeys.includes(`=${typical.value}`)) continue;
    // Don't add a category that starts at a million (French/Spanish/Italian
    // `many`): runtimes fall back to `other`, and it would bloat every plural.
    const smallest = pluralSample(lang, cat, type, (n) => n < 1_000_000);
    if (derived && smallest && smallest.value >= 1_000_000) continue;
    const avoid = literals(derived ? "other" : cat);
    let sample = pluralSample(lang, cat, type, (n) => natural(n) && !avoid.has(n));
    if (sample && avoid.has(sample.value)) sample = pluralSample(lang, cat, type, (n) => !avoid.has(n));
    if (sample && avoid.has(sample.value)) sample = null;
    plan.push({ key: cat, derived, sample: sample?.value, exact: sample?.exact });
  }
  return plan;
}
