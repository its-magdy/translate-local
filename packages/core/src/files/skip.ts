const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
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
