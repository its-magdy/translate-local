import { z } from "zod";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { TlError } from "@translate-local/shared/errors";
import type { AdapterBackend, AdapterConfig } from "@translate-local/shared/types";
import {
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_CONFIG_PATH,
  DEFAULT_GLOSSARY_DB_PATH,
  DEFAULT_CONTEXT_DB_PATH,
  DEFAULT_GLOSSARY_MODE,
} from "@translate-local/shared/constants";
import { ensurePrivateDir } from "./fsutil";

function expandTilde(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function lookupEnv(key: string): string {
  const val = process.env[key];
  if (val === undefined) {
    throw new TlError(
      "CONFIG_INVALID",
      `Environment variable "${key}" is not set`,
      `Set the ${key} environment variable before running tl`,
    );
  }
  return val;
}

// Substitutes ${VAR} in already-parsed string values, not in the raw JSON text —
// a value containing `\` (Windows paths) or `"` would otherwise break JSON.parse
// or inject structure.
// Substitution always yields a string: the env value's *shape* says nothing about
// the field's type, so `"model": "${TL_MODEL}"` with TL_MODEL=2 must stay "2".
// Number/boolean fields opt into coercion in configSchema instead (envNumber /
// envBoolean), where the target type is actually known.
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => lookupEnv(key));
  }
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvVars(v)]));
  }
  return value;
}

function stripJsoncComments(src: string): string {
  // State-machine parser: skips comment characters inside JSON strings.
  let result = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      // Consume string literal verbatim
      result += ch;
      i++;
      while (i < src.length) {
        const sc = src[i];
        result += sc;
        i++;
        if (sc === "\\") {
          // Escape sequence: copy next char and continue
          if (i < src.length) { result += src[i]; i++; }
        } else if (sc === '"') {
          break;
        }
      }
    } else if (ch === "/" && src[i + 1] === "*") {
      // Block comment: skip until */
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (ch === "/" && src[i + 1] === "/") {
      // Line comment: skip until newline
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

// Scalar fields accept the string a `${VAR}` substitution leaves behind and
// convert it to the declared type. Booleans are matched literally — z.coerce
// .boolean() is truthiness-based, so it would read "false" as true.
const envNumber = (inner: z.ZodNumber) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v),
    inner,
  );
const envBoolean = () =>
  z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

// .prefault({}) parses the empty object through the inner schema, so each
// per-field .default() is the single source of truth for that default.
export const configSchema = z.object({
  adapter: z.object({
    type: z.literal("translate-gemma").default("translate-gemma"),
    backend: z.literal("local").default("local"),
    local: z.object({
      command: z.string().default("ollama"),
      model: z.string().default(DEFAULT_MODEL),
      endpoint: z.string().default(DEFAULT_OLLAMA_URL),
      keepAlive: envBoolean().default(false),
    }).prefault({}),
  }).prefault({}),
  glossary: z.object({
    mode: z.enum(["strict", "prefer"]).default(DEFAULT_GLOSSARY_MODE),
    maxRetries: envNumber(z.number().int().min(0).max(10)).default(2),
    dbPath: z.string().default(DEFAULT_GLOSSARY_DB_PATH),
  }).prefault({}),
  context: z.object({
    dbPath: z.string().default(DEFAULT_CONTEXT_DB_PATH),
    maxSnippets: envNumber(z.number().int().min(0)).default(3),
    minRelevance: envNumber(z.number().min(0).max(1)).default(0.3),
  }).prefault({}),
  defaults: z.object({
    sourceLang: z.string().default("auto"),
    targetLang: z.string().default("ar"),
  }).prefault({}),
});

export type CoreConfig = z.infer<typeof configSchema>;

/** Map the loaded config to the adapter factory's input. */
export function toAdapterConfig(config: CoreConfig, backend: AdapterBackend = "ollama"): AdapterConfig {
  return {
    backend,
    model: config.adapter.local.model,
    ollamaUrl: config.adapter.local.endpoint,
  };
}

export function getConfigPath(configPath?: string): string {
  return expandTilde(configPath ?? DEFAULT_CONFIG_PATH);
}

export function loadConfig(configPath?: string): CoreConfig {
  const p = getConfigPath(configPath);
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return configSchema.parse({});
    }
    throw new TlError(
      "CONFIG_NOT_FOUND",
      `Cannot read config at ${p}: ${err.message}`,
      `Check that ${p} is readable`,
      err,
    );
  }

  let parsed: unknown;
  try {
    raw = stripJsoncComments(raw);
    parsed = JSON.parse(raw);
  } catch (err: any) {
    // Unquoted ${VAR} substitution (pre-0.4.1) fails JSON.parse here; point at
    // the migration instead of leaving a bare syntax error.
    const hint = /\$\{[^}]*\}/.test(raw)
      ? `Fix the syntax in ${p}. \${VAR} must be inside a quoted string ("\${VAR}") — a value that is exactly one \${VAR} still loads numbers and booleans with the right type.`
      : `Fix the syntax in ${p}`;
    throw new TlError(
      "CONFIG_INVALID",
      `Config file is not valid JSONC: ${err.message}`,
      hint,
      err,
    );
  }
  parsed = resolveEnvVars(parsed);

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new TlError("CONFIG_INVALID", `Config validation failed: ${issues}`, `Check the config schema in ${p}`);
  }

  const cfg = result.data;
  cfg.glossary.dbPath = expandTilde(cfg.glossary.dbPath);
  cfg.context.dbPath = expandTilde(cfg.context.dbPath);
  return cfg;
}

export function saveConfig(config: CoreConfig, configPath?: string): void {
  const p = getConfigPath(configPath);
  ensurePrivateDir(p);
  writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}
