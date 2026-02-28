// Canonical language map: BCP-47 code → display name.
// All three language lists in the codebase (CLI validation, adapter prompts,
// TUI picker) are derived from this single source of truth.
export const LANG_NAMES: Record<string, string> = {
  aa: "Afar", ab: "Abkhazian", af: "Afrikaans", ak: "Akan", am: "Amharic",
  an: "Aragonese", ar: "Arabic", as: "Assamese", az: "Azerbaijani",
  ba: "Bashkir", be: "Belarusian", bg: "Bulgarian", bm: "Bambara",
  bn: "Bengali", bo: "Tibetan", br: "Breton", bs: "Bosnian",
  ca: "Catalan", ce: "Chechen", co: "Corsican", cs: "Czech",
  cv: "Chuvash", cy: "Welsh",
  da: "Danish", de: "German", dv: "Divehi", dz: "Dzongkha",
  ee: "Ewe", el: "Greek", en: "English", eo: "Esperanto",
  es: "Spanish", et: "Estonian", eu: "Basque",
  fa: "Persian", ff: "Fulah", fi: "Finnish", fil: "Filipino",
  fo: "Faroese", fr: "French", fy: "Western Frisian",
  ga: "Irish", gd: "Scottish Gaelic", gl: "Galician", gn: "Guarani",
  gu: "Gujarati", gv: "Manx",
  ha: "Hausa", he: "Hebrew", hi: "Hindi", hr: "Croatian",
  ht: "Haitian", hu: "Hungarian", hy: "Armenian",
  ia: "Interlingua", id: "Indonesian", ie: "Interlingue", ig: "Igbo",
  ii: "Sichuan Yi", ik: "Inupiaq", io: "Ido", is: "Icelandic",
  it: "Italian", iu: "Inuktitut",
  ja: "Japanese", jv: "Javanese",
  ka: "Georgian", ki: "Kikuyu", kk: "Kazakh", kl: "Kalaallisut",
  km: "Central Khmer", kn: "Kannada", ko: "Korean", ks: "Kashmiri",
  ku: "Kurdish", kw: "Cornish", ky: "Kyrgyz",
  la: "Latin", lb: "Luxembourgish", lg: "Ganda", ln: "Lingala",
  lo: "Lao", lt: "Lithuanian", lu: "Luba-Katanga", lv: "Latvian",
  mg: "Malagasy", mi: "Maori", mk: "Macedonian", ml: "Malayalam",
  mn: "Mongolian", mr: "Marathi", ms: "Malay", mt: "Maltese",
  my: "Burmese",
  nb: "Norwegian Bokmål", nd: "North Ndebele", ne: "Nepali",
  nl: "Dutch", nn: "Norwegian Nynorsk", no: "Norwegian", nr: "South Ndebele", nv: "Navajo",
  ny: "Chichewa",
  oc: "Occitan", om: "Oromo", or: "Oriya", os: "Ossetian",
  pa: "Punjabi", pl: "Polish", ps: "Pashto", pt: "Portuguese",
  qu: "Quechua",
  rm: "Romansh", rn: "Rundi", ro: "Romanian", ru: "Russian",
  rw: "Kinyarwanda",
  sa: "Sanskrit", sc: "Sardinian", sd: "Sindhi", se: "Northern Sami",
  sg: "Sango", si: "Sinhala", sk: "Slovak", sl: "Slovenian",
  sn: "Shona", so: "Somali", sq: "Albanian", sr: "Serbian",
  ss: "Swati", st: "Southern Sotho", su: "Sundanese", sv: "Swedish",
  sw: "Swahili",
  ta: "Tamil", te: "Telugu", tg: "Tajik", th: "Thai", ti: "Tigrinya",
  tk: "Turkmen", tl: "Tagalog", tn: "Tswana", to: "Tonga",
  tr: "Turkish", ts: "Tsonga", tt: "Tatar",
  ug: "Uyghur", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek",
  ve: "Venda", vi: "Vietnamese", vo: "Volapük",
  wa: "Walloon", wo: "Wolof",
  xh: "Xhosa",
  yi: "Yiddish", yo: "Yoruba",
  za: "Zhuang", zh: "Chinese (Simplified)", "zh-tw": "Chinese (Traditional)",
  zu: "Zulu",
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
