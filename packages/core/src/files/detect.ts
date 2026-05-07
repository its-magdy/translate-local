import type { JsonValue } from "./walk";

export type ParseFormat = "json" | "yaml";

export type ContentFormat =
  | "vanilla"           // plain nested JSON / YAML — supported
  | "i18next-plurals"   // i18next v4 plural-key suffix style — supported with warning
  | "lingui-minimal"    // { id: "translation" } — same as vanilla, recognized for clarity
  | "lingui-full"       // { id: { translation, message, description, origin } } — refused
  | "formatjs"          // { id: { defaultMessage, description } } — refused if any value has ICU
  | "arb"               // Flutter ARB with @key metadata — refused
  | "xcstrings";        // Apple String Catalog — refused

export type FormatOverride =
  | "auto"
  | "json"
  | "yaml"
  | "raw-json"
  | "raw-yaml";

export type DetectResult = {
  parse: ParseFormat;
  content: ContentFormat;
  supported: boolean;
  refusalHint?: string;
  raw: boolean;
};

const I18NEXT_PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

export function parseFormatFromExt(ext: string): ParseFormat | null {
  const lower = ext.toLowerCase();
  if (lower === ".json") return "json";
  if (lower === ".yaml" || lower === ".yml") return "yaml";
  return null;
}

export function resolveParseFormat(ext: string, override: FormatOverride): ParseFormat | null {
  if (override === "json" || override === "raw-json") return "json";
  if (override === "yaml" || override === "raw-yaml") return "yaml";
  return parseFormatFromExt(ext);
}

export function detectContentFormat(root: JsonValue): ContentFormat {
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return "vanilla";
  }
  const obj = root as { [k: string]: JsonValue };

  if (
    typeof obj.sourceLanguage === "string" &&
    "strings" in obj &&
    typeof obj.strings === "object" &&
    obj.strings !== null
  ) {
    return "xcstrings";
  }

  for (const k of Object.keys(obj)) {
    if (/^@[^@]/.test(k) || k === "@@locale" || k === "@@last_modified") {
      return "arb";
    }
  }

  for (const v of Object.values(obj)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "defaultMessage" in (v as object) &&
      typeof (v as { defaultMessage?: unknown }).defaultMessage === "string"
    ) {
      return "formatjs";
    }
  }

  for (const v of Object.values(obj)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof (v as { translation?: unknown }).translation === "string" &&
      typeof (v as { message?: unknown }).message === "string"
    ) {
      return "lingui-full";
    }
  }

  if (hasI18nextPluralKeys(obj)) return "i18next-plurals";

  return "vanilla";
}

function hasI18nextPluralKeys(node: JsonValue): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    for (const item of node) if (hasI18nextPluralKeys(item)) return true;
    return false;
  }
  for (const key of Object.keys(node)) {
    if (I18NEXT_PLURAL_SUFFIX.test(key)) {
      const stem = key.replace(I18NEXT_PLURAL_SUFFIX, "");
      const siblings = Object.keys(node);
      if (siblings.some((k) => k !== key && k.replace(I18NEXT_PLURAL_SUFFIX, "") === stem)) {
        return true;
      }
    }
    const child = (node as { [k: string]: JsonValue })[key];
    if (hasI18nextPluralKeys(child)) return true;
  }
  return false;
}

export function detect(ext: string, root: JsonValue, override: FormatOverride): DetectResult {
  const raw = override === "raw-json" || override === "raw-yaml";
  const parse = resolveParseFormat(ext, override);
  if (parse === null) {
    return {
      parse: "json",
      content: "vanilla",
      supported: false,
      refusalHint: `Unsupported extension "${ext}". Use .json, .yaml, or .yml, or pass --format.`,
      raw,
    };
  }

  if (raw) {
    return { parse, content: "vanilla", supported: true, raw };
  }

  const content = detectContentFormat(root);

  switch (content) {
    case "vanilla":
    case "i18next-plurals":
    case "lingui-minimal":
      return { parse, content, supported: true, raw };
    case "arb":
      return {
        parse,
        content,
        supported: false,
        raw,
        refusalHint:
          "Flutter ARB files contain @key metadata and ICU MessageFormat that need format-specific handling. Pass --format raw-json to translate every leaf anyway (may corrupt metadata).",
      };
    case "xcstrings":
      return {
        parse,
        content,
        supported: false,
        raw,
        refusalHint:
          "Apple String Catalog (.xcstrings) files have a per-locale state machine that needs format-specific handling. Pass --format raw-json to translate every leaf anyway.",
      };
    case "formatjs":
      return {
        parse,
        content,
        supported: false,
        raw,
        refusalHint:
          "FormatJS catalogs contain ICU MessageFormat in defaultMessage values. Pass --format raw-json to translate every leaf anyway (ICU bodies may be corrupted).",
      };
    case "lingui-full":
      return {
        parse,
        content,
        supported: false,
        raw,
        refusalHint:
          "Lingui full-mode catalogs need format-specific handling. Use lingui-minimal mode, or pass --format raw-json.",
      };
  }
}
