import { SUPPORTED_LANGUAGE_SET } from "../constants";

/**
 * Normalize a language tag to lowercase BCP-47 (e.g. "EN" → "en", "zh-CN" → "zh-cn").
 * Trims surrounding whitespace and lowercases; does not validate.
 */
export function normalizeLang(lang: string): string {
  return lang.trim().toLowerCase();
}

/**
 * Return true if the language code is in the supported set (after normalization).
 * Accepts both full BCP-47 tags (e.g. "zh-CN") and base codes (e.g. "zh").
 * Regional subtags fall back to the base code (e.g. "zh-TW" → "zh").
 * Note: this means distinct regional variants like zh-TW and zh-HK both return
 * true via the same base code — callers cannot distinguish exact vs fallback matches.
 */
export function isSupported(lang: string): boolean {
  const normalized = normalizeLang(lang);
  if (SUPPORTED_LANGUAGE_SET.has(normalized)) return true;
  const base = normalized.split("-")[0];
  return SUPPORTED_LANGUAGE_SET.has(base);
}
