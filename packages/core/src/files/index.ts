import { existsSync, statSync } from "fs";
import { extname } from "path";
import type { Adapter, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import type { GlossaryStore } from "../glossary";
import type { ContextStore } from "../context";
import { runPipeline } from "../pipeline";
import { detect, resolveParseFormat, type FormatOverride, type ContentFormat } from "./detect";
import { readJson, writeJson, type JsonMeta } from "./json";
import { readYaml, writeYaml, type YamlReadResult } from "./yaml";
import { diffForSync, makeEmptyTargetLike, type SyncMode } from "./sync";
import { mask, unmask, validate, containsICU } from "./placeholders";
import { classifyValue } from "./skip";
import type { JsonValue } from "./walk";

export type FileTranslateOptions = {
  sourcePath: string;
  outPath: string;
  sourceLang: string;
  targetLang: string;
  adapter: Adapter;
  glossary: GlossaryStore;
  context: ContextStore;
  format?: FormatOverride;
  mode?: SyncMode;
  glossaryMode?: "prefer" | "strict";
  /**
   * Default true. When true, validation failures (e.g. placeholder mismatch
   * after retries) record the key in the summary and fall back to the source
   * value, but the run continues. When false, the first failure aborts.
   */
  continueOnError?: boolean;
  translateAll?: boolean;
  maxFileBytes?: number;
  /** When true, classify and count leaves without calling the adapter or writing output. */
  dryRun?: boolean;
  onProgress?: (info: { done: number; total: number; path: string }) => void;
};

export type FileTranslateSummary = {
  contentFormat: ContentFormat;
  totalLeaves: number;
  translated: number;
  skipped: { count: number; reasons: Record<string, number> };
  failed: { path: string; reason: string }[];
  warnings: string[];
  outPath: string;
};

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

// 10 retries gives ~99.9% success at ~50% per-attempt rate; cost is paid only on stubborn keys.
const MAX_PLACEHOLDER_RETRIES = 10;

export async function translateFile(opts: FileTranslateOptions): Promise<FileTranslateSummary> {
  const {
    sourcePath,
    outPath,
    sourceLang,
    targetLang,
    adapter,
    glossary,
    context,
    format = "auto",
    mode = "missing-only",
    glossaryMode = "prefer",
    continueOnError = true,
    translateAll = false,
    maxFileBytes = DEFAULT_MAX_BYTES,
    dryRun = false,
    onProgress,
  } = opts;

  if (sourceLang !== "auto" && sourceLang === targetLang) {
    throw new TlError(
      "SAME_LOCALE",
      `Source and target language are both "${sourceLang}"`,
      "Pass --from and --to with different language codes.",
    );
  }

  if (!existsSync(sourcePath)) {
    throw new TlError("FILE_NOT_FOUND", `Source file not found: ${sourcePath}`, "Check the file path and try again.");
  }

  const stat = statSync(sourcePath);
  if (stat.size > maxFileBytes) {
    throw new TlError(
      "FILE_TOO_LARGE",
      `Source file is ${stat.size} bytes, exceeds limit ${maxFileBytes}`,
      "Use --max-size to override, or split the file.",
    );
  }

  const ext = extname(sourcePath);
  const parseFormat = resolveParseFormat(ext, format);
  if (parseFormat === null) {
    throw new TlError(
      "FILE_INVALID_FORMAT",
      `Unsupported extension "${ext}"`,
      "Use .json, .yaml, or .yml, or pass --format.",
    );
  }

  let sourceData: JsonValue;
  let jsonMeta: JsonMeta | undefined;
  let yamlRead: YamlReadResult | undefined;

  try {
    if (parseFormat === "yaml") {
      yamlRead = readYaml(sourcePath);
      sourceData = yamlRead.data;
    } else {
      const r = readJson(sourcePath);
      sourceData = r.data;
      jsonMeta = r.meta;
    }
  } catch (err) {
    if (err instanceof TlError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_PARSE_FAILED", `Failed to parse ${sourcePath}: ${msg}`, "Validate the file with a linter (e.g. `jq .` or `yq .`) before translating.", err);
  }

  const detected = detect(ext, sourceData, format);
  if (!detected.supported) {
    throw new TlError(
      "FILE_INVALID_FORMAT",
      `Unsupported format: ${detected.content}`,
      detected.refusalHint ?? "Format not supported in v1.",
    );
  }

  let targetData: JsonValue;
  if (existsSync(outPath)) {
    try {
      if (parseFormat === "yaml") {
        targetData = readYaml(outPath).data;
      } else {
        targetData = readJson(outPath).data;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("FILE_PARSE_FAILED", `Failed to parse existing target ${outPath}: ${msg}`, "Fix or delete the existing target file before re-running.", err);
    }
  } else {
    targetData = makeEmptyTargetLike(sourceData);
  }

  const pending = diffForSync(sourceData, targetData, mode);

  const summary: FileTranslateSummary = {
    contentFormat: detected.content,
    totalLeaves: pending.length,
    translated: 0,
    skipped: { count: 0, reasons: {} },
    failed: [],
    warnings: [],
    outPath,
  };

  if (detected.content === "i18next-plurals") {
    summary.warnings.push(
      "i18next plural keys are translated 1:1 from source. Target locale CLDR plural categories may differ — review output manually.",
    );
  }

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const pathStr = p.path.map(String).join(".");
    onProgress?.({ done: i, total: pending.length, path: pathStr });

    if (!translateAll) {
      const cls = classifyValue(p.source);
      if (cls.skip) {
        if (!dryRun) p.set(p.source);
        summary.skipped.count++;
        summary.skipped.reasons[cls.reason] = (summary.skipped.reasons[cls.reason] ?? 0) + 1;
        continue;
      }
    }

    if (containsICU(p.source)) {
      const reason = `Contains ICU MessageFormat at ${pathStr}`;
      if (continueOnError) {
        summary.failed.push({ path: pathStr, reason });
        if (!dryRun) p.set(p.source);
        continue;
      }
      throw new TlError(
        "FILE_INVALID_FORMAT",
        reason,
        "ICU plural/select bodies are not translated in v1. Use --continue-on-error to skip these keys.",
      );
    }

    if (dryRun) {
      summary.translated++;
      continue;
    }

    const { masked, placeholders } = mask(p.source);

    // translategemma reliably honors <term> tags from the glossary path; routing
    // sentinels through that channel preserves them better than naked-token instructions.
    const sentinelHits: GlossaryHit[] = [];
    for (const ph of placeholders) {
      const tok = `__TLPH_${ph.index}__`;
      const idx = masked.indexOf(tok);
      if (idx >= 0) {
        sentinelHits.push({
          entry: { id: `__sentinel_${ph.index}`, sourceTerm: tok, targetTerm: tok, sourceLang, targetLang },
          startIndex: idx,
          endIndex: idx + tok.length,
        });
      }
    }

    const snippets = context.retrieve(p.source, 3).map((s) => s.content);

    let restored = "";
    let lastReason = "";
    let succeeded = false;

    for (let attempt = 0; attempt < MAX_PLACEHOLDER_RETRIES; attempt++) {
      let translatedMasked: string;
      try {
        const result = await runPipeline(masked, sourceLang, targetLang, adapter, glossary, {
          glossaryMode,
          contextSnippets: snippets,
          extraGlossaryHits: sentinelHits,
        });
        translatedMasked = result.translated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastReason = `Pipeline failed at ${pathStr}: ${msg}`;
        if (continueOnError) break;
        throw err;
      }

      restored = unmask(translatedMasked, placeholders);
      if (placeholders.length === 0) {
        succeeded = true;
        break;
      }
      const v = validate(p.source, restored);
      if (v.ok) {
        succeeded = true;
        break;
      }
      lastReason = `Placeholder mismatch at ${pathStr} (attempt ${attempt + 1}/${MAX_PLACEHOLDER_RETRIES}) — missing: [${v.missing.join(", ")}], extra: [${v.extra.join(", ")}]`;
    }

    if (!succeeded) {
      if (continueOnError) {
        // Fall back to source so every key has a value; user can grep source text to find failures.
        summary.failed.push({ path: pathStr, reason: lastReason });
        p.set(p.source);
        continue;
      }
      throw new TlError(
        "PLACEHOLDER_MISMATCH",
        lastReason,
        "The model output dropped or altered placeholders across all retries. Pass --strict only if you want abort-on-failure; otherwise the default continues with source-as-fallback.",
      );
    }

    p.set(restored);
    summary.translated++;
  }
  onProgress?.({ done: pending.length, total: pending.length, path: "" });

  if (dryRun) return summary;

  try {
    if (parseFormat === "yaml") {
      writeYaml(outPath, yamlRead!.doc, yamlRead!.meta, targetData);
    } else {
      writeJson(outPath, targetData, jsonMeta!);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Failed to write ${outPath}: ${msg}`, "Check that the output path is writable.", err);
  }

  // Re-parse from disk validates that what we wrote actually round-trips.
  try {
    if (parseFormat === "yaml") readYaml(outPath);
    else readJson(outPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Output file failed re-parse validation: ${msg}`, "This is a bug in tl — please report.", err);
  }

  return summary;
}
