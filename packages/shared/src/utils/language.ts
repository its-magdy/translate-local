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

/** Base language codes written right-to-left. */
export const RTL_LANGS: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

const RTL_CHARS_RE = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

/** True if the language tag's base code is written right-to-left. */
export function isRtlLang(lang: string): boolean {
  return RTL_LANGS.has(normalizeLang(lang).split("-")[0]);
}

/** True if the text contains right-to-left characters. */
export function hasRtlChars(text: string): boolean {
  return RTL_CHARS_RE.test(text);
}
