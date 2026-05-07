// Single source of truth for shell completion generators.
// Hand-maintained alongside the Commander definitions in apps/cli/src/commands/.
// The drift-detection test in __tests__/completion.test.ts walks the live program
// tree and fails if a command or flag is added to one place without the other.

import { SUPPORTED_LANGUAGES } from "@translate-local/shared/constants";

export type ArgKind = "lang" | "path" | "choice" | "value" | "text";

export interface OptionSpec {
  flag: string;
  takes?: ArgKind;
  choices?: readonly string[];
  pathExts?: readonly string[];
  description: string;
}

export interface PositionalSpec {
  name: string;
  required: boolean;
  takes?: ArgKind;
  choices?: readonly string[];
  pathExts?: readonly string[];
}

export interface CommandSpec {
  name: string;
  description: string;
  positionals?: PositionalSpec[];
  options: OptionSpec[];
  subcommands?: CommandSpec[];
}

export interface RootSpec {
  name: string;
  description: string;
  globalFlags: OptionSpec[];
  commands: CommandSpec[];
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"] as const;
const CATALOG_EXTS = ["json", "yaml", "yml"] as const;
const GLOSSARY_MODES = ["prefer", "strict"] as const;
const FILE_FORMATS = ["auto", "json", "yaml", "raw-json", "raw-yaml"] as const;
const SHELLS = ["bash", "zsh", "fish"] as const;

export const SPEC: RootSpec = {
  name: "tl",
  description: "Translation CLI — glossary-aware, context-rich, model-agnostic",
  globalFlags: [
    { flag: "--help", description: "Show help" },
    { flag: "-h", description: "Show help" },
    { flag: "--version", description: "Show version" },
    { flag: "-V", description: "Show version" },
  ],
  commands: [
    {
      name: "translate",
      description: "Translate text, an image, or a JSON/YAML file",
      positionals: [{ name: "text", required: false, takes: "text" }],
      options: [
        { flag: "--from", takes: "lang", description: "Source language (BCP-47 or auto)" },
        { flag: "--to", takes: "lang", description: "Target language (BCP-47)" },
        { flag: "--image", takes: "path", pathExts: IMAGE_EXTS, description: "Path to an image file" },
        { flag: "--glossary", takes: "choice", choices: GLOSSARY_MODES, description: "Glossary mode" },
        { flag: "--json", description: "Output JSON" },
        { flag: "--file", takes: "path", pathExts: CATALOG_EXTS, description: "Path to JSON/YAML catalog" },
        { flag: "--out", takes: "path", description: "Output path for file mode" },
        { flag: "--force", description: "File mode: re-translate every leaf" },
        { flag: "--dry-run", description: "File mode: list keys without writing" },
        { flag: "--format", takes: "choice", choices: FILE_FORMATS, description: "File mode: format override" },
        { flag: "--strict", description: "File mode: abort on first failure" },
        { flag: "--translate-all", description: "File mode: bypass skip heuristics" },
        { flag: "--max-size", takes: "value", description: "File mode: max file size in MB" },
      ],
    },
    {
      name: "glossary",
      description: "Manage glossary entries",
      options: [],
      subcommands: [
        {
          name: "add",
          description: "Add a glossary entry",
          options: [
            { flag: "--source", takes: "value", description: "Source term" },
            { flag: "--target", takes: "value", description: "Target term" },
            { flag: "--from", takes: "lang", description: "Source language" },
            { flag: "--to", takes: "lang", description: "Target language" },
            { flag: "--domain", takes: "value", description: "Domain tag" },
            { flag: "--note", takes: "value", description: "Note" },
          ],
        },
        {
          name: "list",
          description: "List glossary entries",
          options: [
            { flag: "--from", takes: "lang", description: "Filter by source language" },
            { flag: "--to", takes: "lang", description: "Filter by target language" },
            { flag: "--domain", takes: "value", description: "Filter by domain" },
            { flag: "--json", description: "Output JSON" },
          ],
        },
        {
          name: "remove",
          description: "Remove a glossary entry by id (prefix accepted)",
          positionals: [{ name: "id", required: true, takes: "value" }],
          options: [],
        },
        {
          name: "import",
          description: "Import entries from a CSV file",
          positionals: [{ name: "file", required: true, takes: "path", pathExts: ["csv"] }],
          options: [],
        },
        {
          name: "export",
          description: "Export entries as CSV (or JSON with --json)",
          options: [
            { flag: "--from", takes: "lang", description: "Filter by source language" },
            { flag: "--to", takes: "lang", description: "Filter by target language" },
            { flag: "--json", description: "Output JSON" },
          ],
        },
      ],
    },
    {
      name: "context",
      description: "Manage context sources",
      options: [],
      subcommands: [
        { name: "add", description: "Add a directory as context source", positionals: [{ name: "path", required: true, takes: "path" }], options: [] },
        { name: "list", description: "List context sources", options: [{ flag: "--json", description: "Output JSON" }] },
        { name: "remove", description: "Remove a context source by path", positionals: [{ name: "path", required: true, takes: "path" }], options: [] },
        { name: "index", description: "Re-index all context sources", options: [] },
      ],
    },
    {
      name: "config",
      description: "Manage tl configuration",
      options: [],
      subcommands: [
        {
          name: "connect",
          description: "Configure adapter backend",
          options: [
            { flag: "--model", takes: "value", description: "Model name" },
            { flag: "--endpoint", takes: "value", description: "Ollama endpoint URL" },
          ],
        },
        { name: "status", description: "Show current configuration", options: [] },
        { name: "path", description: "Print config file path", options: [] },
      ],
    },
    {
      name: "languages",
      description: "List all supported language codes and names",
      options: [{ flag: "--json", description: "Output JSON" }],
    },
    {
      name: "completion",
      description: "Generate shell completion script (bash, zsh, fish)",
      positionals: [{ name: "shell", required: true, takes: "choice", choices: SHELLS }],
      options: [],
    },
  ],
};

export const LANGS: readonly string[] = SUPPORTED_LANGUAGES;
export const SUPPORTED_SHELLS = SHELLS;
export type SupportedShell = (typeof SHELLS)[number];
