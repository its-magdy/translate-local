import { SUPPORTED_LANGUAGE_SET } from "../constants";

/**
 * Normalize a language tag to lowercase BCP-47 (e.g. "EN" → "en", "zh-CN" → "zh-cn").
 * Only normalizes case; does not validate.
 */
export function normalizeLang(lang: string): string {
  return lang.toLowerCase();
}

/**
 * Return true if the language code is in the supported set (after normalization).
 */
export function isSupported(lang: string): boolean {
  return SUPPORTED_LANGUAGE_SET.has(normalizeLang(lang));
}
