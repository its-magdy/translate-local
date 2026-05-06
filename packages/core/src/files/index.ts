/**
 * File-translate orchestrator.
 *
 * Reads a source catalog, detects format, loads or seeds the target, computes
 * the sync diff, and translates each pending leaf via the existing pipeline —
 * with placeholder protection and skip heuristics applied per leaf.
 *
 * Adapter and stores are constructed by the caller and passed in. The
 * orchestrator does NOT call adapter.dispose(); the caller owns lifecycle.
 *
 * On success: atomic write of the target file. The original target is intact
 * until the rename succeeds.
 */

import { existsSync, statSync } from "fs";
import { extname } from "path";
import type { Adapter } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import type { GlossaryStore } from "../glossary";
import type { ContextStore } from "../context";
import { runPipeline } from "../pipeline";
import { detect, type FormatOverride, type ContentFormat } from "./detect";
import { readJson, writeJson, type JsonMeta } from "./json";
import { readYaml, writeYaml, type YamlReadResult } from "./yaml";
import { diffForSync, makeEmptyTargetLike, type SyncMode, type PendingTranslation } from "./sync";
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
  continueOnError?: boolean;
  translateAll?: boolean;
  maxFileBytes?: number;
  /** Called as each leaf finishes. Useful for stderr progress. */
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
    continueOnError = false,
    translateAll = false,
    maxFileBytes = DEFAULT_MAX_BYTES,
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

  // Read source — preliminary parse to feed format detection
  let sourceData: JsonValue;
  let jsonMeta: JsonMeta | undefined;
  let yamlRead: YamlReadResult | undefined;

  const probeFormat =
    format === "raw-yaml" || format === "yaml"
      ? "yaml"
      : format === "raw-json" || format === "json"
        ? "json"
        : ext.toLowerCase() === ".yaml" || ext.toLowerCase() === ".yml"
          ? "yaml"
          : "json";

  try {
    if (probeFormat === "yaml") {
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

  // Read target if it exists
  let targetData: JsonValue;
  if (existsSync(outPath)) {
    try {
      if (probeFormat === "yaml") {
        const r = readYaml(outPath);
        targetData = r.data;
      } else {
        const r = readJson(outPath);
        targetData = r.data;
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

  // Per-leaf translation
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const pathStr = p.path.map(String).join(".");
    onProgress?.({ done: i, total: pending.length, path: pathStr });

    // Skip heuristics
    if (!translateAll) {
      const cls = classifyValue(p.source);
      if (cls.skip) {
        // Copy source value through; preserves URL/email/etc. unchanged
        p.set(p.source);
        summary.skipped.count++;
        summary.skipped.reasons[cls.reason] = (summary.skipped.reasons[cls.reason] ?? 0) + 1;
        continue;
      }
    }

    // ICU refusal at per-leaf level (in addition to format-level)
    if (containsICU(p.source)) {
      const reason = `Contains ICU MessageFormat at ${pathStr}`;
      if (continueOnError) {
        summary.failed.push({ path: pathStr, reason });
        p.set(p.source);
        continue;
      }
      throw new TlError(
        "FILE_INVALID_FORMAT",
        reason,
        "ICU plural/select bodies are not translated in v1. Use --continue-on-error to skip these keys.",
      );
    }

    // Mask placeholders
    const { masked, placeholders } = mask(p.source);

    // Retrieve context snippets per-leaf
    const snippets = context.retrieve(p.source, 3).map((s) => s.content);

    // Run the pipeline
    let translatedMasked: string;
    try {
      const result = await runPipeline(masked, sourceLang, targetLang, adapter, glossary, {
        glossaryMode,
        contextSnippets: snippets,
      });
      translatedMasked = result.translated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason = `Pipeline failed at ${pathStr}: ${msg}`;
      if (continueOnError) {
        summary.failed.push({ path: pathStr, reason });
        continue;
      }
      throw err;
    }

    const restored = unmask(translatedMasked, placeholders);
    const v = validate(p.source, restored);
    if (!v.ok) {
      const reason = `Placeholder mismatch at ${pathStr} — missing: [${v.missing.join(", ")}], extra: [${v.extra.join(", ")}]`;
      if (continueOnError) {
        summary.failed.push({ path: pathStr, reason });
        continue;
      }
      throw new TlError(
        "PLACEHOLDER_MISMATCH",
        reason,
        "The model output dropped or altered placeholders. Re-run, or use --continue-on-error to continue.",
      );
    }

    p.set(restored);
    summary.translated++;
  }
  onProgress?.({ done: pending.length, total: pending.length, path: "" });

  // Write — atomic. Preserve source file's metadata (indent / eol / trailing newline)
  // by copying jsonMeta or yamlRead.meta forward. If target existed, we still use the
  // source's formatting so en→ar produces consistently formatted siblings.
  try {
    if (probeFormat === "yaml") {
      if (!yamlRead) throw new Error("internal: yamlRead missing");
      writeYaml(outPath, yamlRead.doc, yamlRead.meta, targetData);
    } else {
      if (!jsonMeta) throw new Error("internal: jsonMeta missing");
      writeJson(outPath, targetData, jsonMeta);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Failed to write ${outPath}: ${msg}`, "Check that the output path is writable.", err);
  }

  // Re-parse output to validate it parses cleanly
  try {
    if (probeFormat === "yaml") readYaml(outPath);
    else readJson(outPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Output file failed re-parse validation: ${msg}`, "This is a bug in tl — please report.", err);
  }

  return summary;
}
