/**
 * Heuristics to identify values that should NOT be translated.
 *
 * Real-world i18n catalogs commonly contain non-string-y values mixed with
 * translatable strings: URLs in `homepage` keys, version numbers, code
 * identifiers, single-char abbreviations. The model will sometimes translate
 * these incorrectly (e.g. "OK" → "حسنا" when it's a button identifier).
 *
 * Conservative skip list. Override with `--translate-all`.
 */

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
// Code-identifier-ish: ALL-CAPS short tokens (e.g. "OK", "ID", "API_KEY")
const ALL_CAPS_SHORT = /^[A-Z][A-Z0-9_]{0,3}$/;

export type SkipReason = "url" | "email" | "semver" | "all-caps-short" | "single-char" | "empty" | "whitespace-only";

export type SkipDecision =
  | { skip: false }
  | { skip: true; reason: SkipReason };

export function classifyValue(value: string): SkipDecision {
  if (value.length === 0) return { skip: true, reason: "empty" };
  if (value.trim().length === 0) return { skip: true, reason: "whitespace-only" };
  if (value.length === 1) return { skip: true, reason: "single-char" };
  if (URL_RE.test(value)) return { skip: true, reason: "url" };
  if (EMAIL_RE.test(value)) return { skip: true, reason: "email" };
  if (SEMVER_RE.test(value)) return { skip: true, reason: "semver" };
  if (ALL_CAPS_SHORT.test(value)) return { skip: true, reason: "all-caps-short" };
  return { skip: false };
}

export function isNonTranslatable(value: string): boolean {
  return classifyValue(value).skip;
}
