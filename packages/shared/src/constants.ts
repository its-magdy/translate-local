// BCP-47 codes for TranslateGemma's 55 benchmarked languages
export const SUPPORTED_LANGUAGES: readonly string[] = [
  "af", "ar", "az", "be", "bg", "bn", "ca", "cs", "cy", "da",
  "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "ga",
  "gl", "gu", "he", "hi", "hr", "hu", "hy", "id", "is", "it",
  "ja", "ka", "kk", "km", "kn", "ko", "lt", "lv", "mk", "ml",
  "mn", "mr", "ms", "mt", "my", "nl", "no", "pl", "pt", "ro",
  "ru", "sk", "sl", "sq", "sr", "sv", "sw", "ta", "te", "th",
  "tl", "tr", "uk", "ur", "vi", "zh",
] as const;

export const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);

export const DEFAULT_MODEL = "translate-gemma-12b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_CONFIG_PATH = "~/.config/tl/config.jsonc";
export const DEFAULT_GLOSSARY_DB_PATH = "~/.config/tl/glossary.db";
export const DEFAULT_CONTEXT_DB_PATH = "~/.config/tl/context.db";
export const DEFAULT_GLOSSARY_MODE = "prefer" as const;
