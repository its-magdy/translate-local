// BCP-47 base codes for the 50 unique target languages in the WMT24++ benchmark
// (WMT24++ has 55 pairs; ar, fr, sw, pt, zh each have two regional variants)
// Source: https://huggingface.co/datasets/google/wmt24pp
// "en" is included as the primary source language for TranslateGemma.
export const SUPPORTED_LANGUAGES: readonly string[] = [
  "en",
  "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "es", "et",
  "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id",
  "is", "it", "ja", "kn", "ko", "lt", "lv", "ml", "mr", "nl",
  "no", "pa", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv",
  "sw", "ta", "te", "th", "tr", "uk", "ur", "vi", "zh", "zu",
] as const;

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
