import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { TlError } from "@tl/shared/errors";

function expandTilde(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function resolveEnvVars(s: string): string {
  return s.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

function stripJsoncComments(src: string): string {
  // Remove /* */ block comments, then // line comments
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

export const configSchema = z.object({
  adapter: z.object({
    type: z.literal("translate-gemma").default("translate-gemma"),
    backend: z.enum(["local", "huggingface"]).default("local"),
    local: z.object({
      command: z.string().default("ollama"),
      model: z.string().default("translate-gemma-12b"),
      endpoint: z.string().default("http://localhost:11434"),
      keepAlive: z.boolean().default(false),
    }).default({ command: "ollama", model: "translate-gemma-12b", endpoint: "http://localhost:11434", keepAlive: false }),
    huggingface: z.object({
      model: z.string().default("google/translategemma-12b-it"),
      token: z.string().optional(),
    }).default({ model: "google/translategemma-12b-it" }),
  }).default({
    type: "translate-gemma",
    backend: "local",
    local: { command: "ollama", model: "translate-gemma-12b", endpoint: "http://localhost:11434", keepAlive: false },
    huggingface: { model: "google/translategemma-12b-it" },
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

export function loadConfig(configPath?: string): CoreConfig {
  const p = expandTilde(configPath ?? "~/.config/tl/config.jsonc");
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

  raw = resolveEnvVars(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsoncComments(raw));
  } catch (err: any) {
    throw new TlError(
      "CONFIG_INVALID",
      `Config file is not valid JSONC: ${err.message}`,
      `Fix the syntax in ${p}`,
      err,
    );
  }

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
  const p = expandTilde(configPath ?? "~/.config/tl/config.jsonc");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2), "utf8");
}
