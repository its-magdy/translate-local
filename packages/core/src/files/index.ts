import { existsSync, lstatSync } from "fs";
import { extname, resolve } from "path";
import type { Adapter, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import type { GlossaryStore } from "../glossary";
import type { ContextStore } from "../context";
import { runPipeline } from "../pipeline";
import { detect, resolveParseFormat, type FormatOverride, type ContentFormat } from "./detect";
import { readJson, writeJson, type JsonMeta } from "./json";
import { readYaml, writeYaml, type YamlReadResult } from "./yaml";
import { diffForSync, makeEmptyTargetLike, type SyncMode } from "./sync";
import { mask, unmask, validate, containsICU, sentinelFor } from "./placeholders";
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

  // The language check above can't fire when sourceLang is "auto", so an
  // en→en run (or an --out aimed at the input) would write the translation
  // back over the source file. Compare the paths directly instead.
  if (resolve(sourcePath) === resolve(outPath)) {
    throw new TlError(
      "SAME_LOCALE",
      `Output path is the same file as the source: ${sourcePath}`,
      "Pass --to with a different language, or --out with a different path.",
    );
  }

  if (!existsSync(sourcePath)) {
    throw new TlError("FILE_NOT_FOUND", `Source file not found: ${sourcePath}`, "Check the file path and try again.");
  }

  // lstat (not stat) so symlinks are inspected, not followed: a symlink to /dev/zero
  // would sail past the size guard and OOM the process; a FIFO would hang readFileSync.
  const stat = lstatSync(sourcePath);
  if (!stat.isFile()) {
    throw new TlError(
      "FILE_INVALID_FORMAT",
      `Source path is not a regular file: ${sourcePath}`,
      "Pass a regular file (no symlinks, FIFOs, sockets, or device nodes).",
    );
  }
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

  // Pre-fetch glossary entries once. runPipeline would otherwise re-query SQLite
  // for every leaf — at N leaves with M entries that's N round-trips and N*M row
  // materializations. We hand the entries through PipelineOptions and let the
  // pipeline match them in-process. Same lang-pair filter as findMatches uses.
  const glossaryEntries = glossary.list(sourceLang, targetLang);

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
        "ICU plural/select bodies are not translated in v1. The default run continues and falls back to source for these keys; pass --strict to abort instead.",
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
      const tok = sentinelFor(ph.index);
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
          glossaryEntries,
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

  // writeJson/writeYaml re-parse the tmp file before the rename, so a malformed
  // serialization never replaces the existing target.
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

  return summary;
}
