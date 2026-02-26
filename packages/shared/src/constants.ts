// Canonical language map: BCP-47 code → display name.
// All three language lists in the codebase (CLI validation, adapter prompts,
// TUI picker) are derived from this single source of truth.
export const LANG_NAMES: Record<string, string> = {
  af: "Afrikaans", am: "Amharic", ar: "Arabic", az: "Azerbaijani",
  be: "Belarusian", bg: "Bulgarian", bn: "Bengali", bs: "Bosnian",
  ca: "Catalan", cs: "Czech", cy: "Welsh", da: "Danish", de: "German",
  el: "Greek", en: "English", es: "Spanish", et: "Estonian", eu: "Basque",
  fa: "Persian", fi: "Finnish", fil: "Filipino", fr: "French",
  ga: "Irish", gl: "Galician", gu: "Gujarati", ha: "Hausa", he: "Hebrew",
  hi: "Hindi", hr: "Croatian", hu: "Hungarian", hy: "Armenian",
  id: "Indonesian", ig: "Igbo", is: "Icelandic", it: "Italian",
  ja: "Japanese", ka: "Georgian", kk: "Kazakh", km: "Khmer", kn: "Kannada",
  ko: "Korean", lo: "Lao", lt: "Lithuanian", lv: "Latvian",
  mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi",
  ms: "Malay", mt: "Maltese", my: "Myanmar", ne: "Nepali", nl: "Dutch",
  no: "Norwegian", or: "Odia", pa: "Punjabi", pl: "Polish", ps: "Pashto",
  pt: "Portuguese", ro: "Romanian", ru: "Russian", sd: "Sindhi",
  si: "Sinhala", sk: "Slovak", sl: "Slovenian", so: "Somali",
  sq: "Albanian", sr: "Serbian", sv: "Swedish", sw: "Swahili",
  ta: "Tamil", te: "Telugu", th: "Thai", tl: "Filipino", tr: "Turkish",
  ug: "Uyghur", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek",
  vi: "Vietnamese", yi: "Yiddish", yo: "Yoruba",
  zh: "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)", zu: "Zulu",
};

export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(LANG_NAMES);

export const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);

export const DEFAULT_MODEL = "translate-gemma-12b";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
/**
 * NOTE: `~` is NOT expanded by Node/Bun. Consumers must resolve this themselves, e.g.:
 *   import os from "os"; import path from "path";
 *   path.join(os.homedir(), ".config/tl/config.jsonc")
 * Prefer the resolver functions below to avoid silent path errors.
 */
export const DEFAULT_CONFIG_PATH = "~/.config/tl/config.jsonc";
export const DEFAULT_GLOSSARY_DB_PATH = "~/.config/tl/glossary.db";
export const DEFAULT_CONTEXT_DB_PATH = "~/.config/tl/context.db";

import { join } from "path";
import { homedir } from "os";
/** Returns the resolved absolute path to the default config file. */
export function resolveConfigPath(): string { return join(homedir(), ".config/tl/config.jsonc"); }
/** Returns the resolved absolute path to the default glossary database. */
export function resolveGlossaryDbPath(): string { return join(homedir(), ".config/tl/glossary.db"); }
/** Returns the resolved absolute path to the default context database. */
export function resolveContextDbPath(): string { return join(homedir(), ".config/tl/context.db"); }
export const DEFAULT_GLOSSARY_MODE = "prefer" as const;
