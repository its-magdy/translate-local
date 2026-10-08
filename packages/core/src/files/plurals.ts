// CLDR plural-category helpers backed by Intl.PluralRules — the same API
// i18next uses at runtime to pick a `_one` / `_few` / … key, so the categories
// generated here are exactly the ones the target locale will look up.
// Format-agnostic on purpose: nothing here knows about i18next key suffixes.

import { PLACEHOLDER_SENTINEL_PREFIX } from "@translate-local/shared/constants";

export type PluralType = "cardinal" | "ordinal";
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

// Probe values for finding a representative number per category. Positive
// integers first (most natural in a sentence), then 0. Two multiples of a
// million so French/Spanish `many` is not mistaken for a single-number category.
// The decimals are only probed to decide `exact` — never returned as a sample:
// a fraction-only category (Russian `other`) has no count worth showing, and
// "1.5 files" derails the model.
const INTEGER_SAMPLES: readonly number[] = [
  ...Array.from({ length: 200 }, (_, i) => i + 1),
  1000, 10000, 100000, 1000000, 2000000,
  0,
];
const DECIMAL_PROBES: readonly number[] = [1.5, 2.5, 0.5];

// Tags the runtime's CLDR data only knows under another code (Bun resolves
// `fil` but not the legacy `tl` for Tagalog/Filipino).
const LANGUAGE_ALIASES: Record<string, string> = { tl: "fil" };

const language = (tag: string): string => tag.split("-")[0].toLowerCase();

/**
 * Intl.PluralRules for `lang`, or null when the runtime cannot resolve it.
 * An unknown-but-well-formed tag ("xx") silently falls back to the runtime's
 * default locale; that is detected and rejected rather than guessed at.
 */
export function pluralRules(lang: string, type: PluralType = "cardinal"): Intl.PluralRules | null {
  try {
    const canonical = Intl.getCanonicalLocales(lang)[0];
    const alias = LANGUAGE_ALIASES[language(canonical)];
    const requested = alias ? canonical.replace(/^[^-]+/, alias) : canonical;
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
 * A representative number for `category` in `lang` — the value to show a model
 * so it inflects the noun for that category. `exact` is true when the category
 * holds only that one number (Arabic `two` is 2 and nothing else), so a
 * translation may spell the number out or drop it without changing meaning.
 * `prefer` picks the first value it accepts, if the category has one.
 * Null when the category holds no integer (fractions only) or `lang` is unknown.
 */
export function pluralSample(
  lang: string,
  category: PluralCategory,
  type: PluralType = "cardinal",
  prefer?: (n: number) => boolean,
): { value: number; exact: boolean } | null {
  const rules = pluralRules(lang, type);
  if (!rules) return null;
  const hits = INTEGER_SAMPLES.filter((n) => rules.select(n) === category);
  if (hits.length === 0) return null;
  const value = (prefer && hits.find(prefer)) ?? hits[0];
  const exact = hits.length === 1 && !DECIMAL_PROBES.some((n) => rules.select(n) === category);
  return { value, exact };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Digit-group separators models write in large numbers: "1,000,000",
// "1.000.000", "1 000 000" (plain, no-break, or narrow no-break space), "1'000'000".
const GROUP_SEP = "[ ,.'’\\u00a0\\u202f]?";
const DECIMAL_SEP = "[.,٫]";

// Unicode decimal digits (\p{Nd}) come in contiguous runs of ten, zero first.
// Collected once so a sample can be matched in any script: 3, ٣, ۳, ३, ৩ …
let digitZeros: number[] | undefined;
function digitClass(d: number): string {
  if (!digitZeros) {
    digitZeros = [];
    const nd = /\p{Nd}/u;
    let run = 0;
    for (let cp = 0; cp < 0x20000; cp++) {
      if (!nd.test(String.fromCodePoint(cp))) {
        run = 0;
        continue;
      }
      if (run++ % 10 === 0) digitZeros.push(cp);
    }
  }
  return `[${digitZeros.map((z) => String.fromCodePoint(z + d)).join("")}]`;
}

/**
 * Global regex matching `value` as a whole number in model output, in any
 * Unicode digit system, with or without digit grouping ("1 000 000"), with
 * either decimal separator ("1.5" / "1,5"), or the way `lang` formats it.
 * Matches a number glued to placeholder sentinels (`__TLPH_0__3__TLPH_1__`)
 * but never the index digits inside one.
 */
export function sampleRegex(value: number, lang: string): RegExp {
  const [int, frac] = String(value).split(".");
  const digits = (s: string): string => [...s].map((c) => digitClass(Number(c))).join("");
  const intGroups = int.length >= 4 ? int.replace(/\B(?=(\d{3})+$)/g, "|").split("|") : [int];
  const forms = [intGroups.map(digits).join(GROUP_SEP) + (frac ? DECIMAL_SEP + digits(frac) : "")];
  try {
    // Covers numbering systems whose digits are not \p{Nd} (e.g. hanidec 三).
    forms.push(escapeRe(new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 20 }).format(value)));
  } catch {
    // Unknown locale — the digit form alone is still matched.
  }
  const sentinelIndex = escapeRe(PLACEHOLDER_SENTINEL_PREFIX) + "\\p{Nd}*";
  // Not preceded by a digit, separator or ASCII letter ("13", "3.5", "mp3"),
  // nor by a sentinel prefix (the `1` in `__TLPH_1__`). A trailing suffix is
  // allowed: ordinals ("1st", "2e") and counters attach to the number.
  return new RegExp(
    `(?<![\\p{Nd}.,٫A-Za-z])(?<!${sentinelIndex})(?:${forms.join("|")})(?!\\p{Nd}|${DECIMAL_SEP}\\p{Nd})`,
    "gu",
  );
}
