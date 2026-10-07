// CLDR plural-category helpers backed by Intl.PluralRules — the same API
// i18next uses at runtime to pick a `_one` / `_few` / … key, so the categories
// generated here are exactly the ones the target locale will look up.
// Format-agnostic on purpose: nothing here knows about i18next key suffixes.

export type PluralType = "cardinal" | "ordinal";
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export const PLURAL_CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

// Probe values for finding a representative number per category. Positive
// integers first (most natural in a sentence), then 0, then decimals for
// categories that only hold fractions (e.g. Russian `other`). Two multiples of
// a million so French/Spanish `many` is not mistaken for a single-number category.
const SAMPLES: readonly number[] = [
  ...Array.from({ length: 200 }, (_, i) => i + 1),
  1000, 10000, 100000, 1000000, 2000000,
  0,
  1.5, 2.5, 0.5,
];

const language = (tag: string): string => tag.split("-")[0].toLowerCase();

/**
 * Intl.PluralRules for `lang`, or null when the runtime cannot resolve it.
 * An unknown-but-well-formed tag ("xx") silently falls back to the runtime's
 * default locale; that is detected and rejected rather than guessed at.
 */
export function pluralRules(lang: string, type: PluralType = "cardinal"): Intl.PluralRules | null {
  try {
    const requested = Intl.getCanonicalLocales(lang)[0];
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
 * `avoid` skips one value when the category has another.
 */
export function pluralSample(
  lang: string,
  category: PluralCategory,
  type: PluralType = "cardinal",
  avoid?: number,
): { value: number; exact: boolean } | null {
  const rules = pluralRules(lang, type);
  if (!rules) return null;
  const hits = SAMPLES.filter((n) => rules.select(n) === category);
  if (hits.length === 0) return null;
  const value = hits.find((n) => n !== avoid) ?? hits[0];
  return { value, exact: hits.length === 1 };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Global regex matching `value` as a whole number in model output, written
 * either in ASCII ("1.5") or the way `lang` formats it ("1,5", "۳").
 */
export function sampleRegex(value: number, lang: string): RegExp {
  const forms = new Set([String(value)]);
  try {
    forms.add(new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 20 }).format(value));
  } catch {
    // Unknown locale — the ASCII form alone is still matched.
  }
  const alt = [...forms].map(escapeRe).join("|");
  // Not preceded by a digit, separator, ASCII letter or underscore — so the
  // index inside a `__TLPH_1__` sentinel or "mp3" never matches. A trailing
  // suffix is allowed: ordinals ("1st", "2e") attach letters to the number.
  return new RegExp(`(?<![\\p{Nd}.,٫A-Za-z_])(?:${alt})(?![\\p{Nd}_]|[.,٫]\\p{Nd})`, "gu");
}
