import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { TlError } from "@translate-local/shared/errors";

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
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    // A value that is exactly one ${VAR} adopts the env value's scalar type, so
    // numeric/boolean fields work: "maxRetries": "${TL_RETRIES}" with
    // TL_RETRIES=3 loads as the number 3. Everything else stays a string.
    const whole = value.match(/^\$\{([^}]+)\}$/);
    if (whole) {
      const val = lookupEnv(whole[1]);
      if (/^(?:-?\d+(?:\.\d+)?|true|false|null)$/.test(val.trim())) return JSON.parse(val.trim());
      return val;
    }
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

export const configSchema = z.object({
  adapter: z.object({
    type: z.literal("translate-gemma").default("translate-gemma"),
    backend: z.literal("local").default("local"),
    local: z.object({
      command: z.string().default("ollama"),
      model: z.string().default("translategemma:latest"),
      endpoint: z.string().default("http://localhost:11434"),
      keepAlive: z.boolean().default(false),
    }).default({ command: "ollama", model: "translategemma:latest", endpoint: "http://localhost:11434", keepAlive: false }),
  }).default({
    type: "translate-gemma",
    backend: "local",
    local: { command: "ollama", model: "translategemma:latest", endpoint: "http://localhost:11434", keepAlive: false },
  }),
  glossary: z.object({
    mode: z.enum(["strict", "prefer"]).default("prefer"),
    maxRetries: z.number().int().min(0).max(10).default(2),
    dbPath: z.string().default("~/.config/tl/glossary.db"),
  }).default({ mode: "prefer", maxRetries: 2, dbPath: "~/.config/tl/glossary.db" }),
  context: z.object({
    dbPath: z.string().default("~/.config/tl/context.db"),
    maxSnippets: z.number().int().min(0).default(3),
    minRelevance: z.number().min(0).max(1).default(0.3),
  }).default({ dbPath: "~/.config/tl/context.db", maxSnippets: 3, minRelevance: 0.3 }),
  defaults: z.object({
    sourceLang: z.string().default("auto"),
    targetLang: z.string().default("ar"),
  }).default({ sourceLang: "auto", targetLang: "ar" }),
});

export type CoreConfig = z.infer<typeof configSchema>;

export function getConfigPath(configPath?: string): string {
  return expandTilde(configPath ?? "~/.config/tl/config.jsonc");
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
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(p), 0o700); } catch { /* may fail on system dirs */ }
  writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}
