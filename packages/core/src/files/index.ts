import { existsSync, lstatSync, realpathSync } from "fs";
import { extname, resolve, dirname, basename, join } from "path";
import type { Adapter, GlossaryHit } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { DEFAULT_MAX_SNIPPETS, DEFAULT_MIN_RELEVANCE } from "@translate-local/shared/constants";
import type { GlossaryStore } from "../glossary";
import type { ContextStore } from "../context";
import { runPipeline } from "../pipeline";
import { detect, resolveParseFormat, type FormatOverride, type ContentFormat } from "./detect";
import { readJson, writeJson, type DuplicateKey, type JsonMeta } from "./json";
import { readYaml, writeYaml, type YamlReadResult } from "./yaml";
import { diffForSync, makeEmptyTargetLike, type SyncMode } from "./sync";
import { mask, unmask, validate, containsICU, sentinelFor } from "./placeholders";
import { classifyValue } from "./skip";
import { rebaseLocaleRoot, renameYamlRootKey, type RootLocaleRename } from "./locale-root";
import { regenerateI18nextPlurals, regenerateYamlPlurals, pathKey, isCountPlaceholder, type PluralRegenResult } from "./i18next";
import { sampleRegex } from "./plurals";
import type { JsonValue } from "./walk";

export type FileTranslateOptions = {
  sourcePath: string;
  outPath: string;
  sourceLang: string;
  targetLang: string;
  /**
   * Locale used to recognise a locale-rooted catalog (Rails `en:` root).
   * Defaults to sourceLang; pass the filename's locale token when sourceLang is "auto".
   */
  sourceLocale?: string;
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
  /** Context snippets per leaf (config `context.maxSnippets`). */
  maxSnippets?: number;
  /** Minimum context relevance, 0–1 (config `context.minRelevance`). */
  minRelevance?: number;
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
  /** Set when the source's root locale key (Rails `en:`) was renamed to the target locale. */
  rootLocaleKey?: RootLocaleRename;
};

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

// 10 retries gives ~99.9% success at ~50% per-attempt rate; cost is paid only on stubborn keys.
const MAX_PLACEHOLDER_RETRIES = 10;

// Attempts that show the model a sample count (e.g. "3 files") for a plural
// form before falling back to translating the bare placeholder text.
const PLURAL_HINT_ATTEMPTS = 3;

// True when both paths name one file on disk. resolve() alone compares strings,
// so it misses symlinked path components ("/tmp/x" vs "/private/tmp/x" on macOS)
// and would let a run overwrite its own source. The output usually does not
// exist yet, so fall back to realpath'ing its directory and re-appending the
// basename; if that directory is missing too, no collision is possible.
function sameFile(sourcePath: string, outPath: string): boolean {
  const real = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      try {
        return join(realpathSync(dirname(p)), basename(p));
      } catch {
        return null;
      }
    }
  };
  const a = real(sourcePath);
  const b = real(outPath);
  if (a === null || b === null) return resolve(sourcePath) === resolve(outPath);
  return a === b;
}

export async function translateFile(opts: FileTranslateOptions): Promise<FileTranslateSummary> {
  const {
    sourcePath,
    outPath,
    sourceLang,
    targetLang,
    sourceLocale = sourceLang === "auto" ? undefined : sourceLang,
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
    maxSnippets = DEFAULT_MAX_SNIPPETS,
    minRelevance = DEFAULT_MIN_RELEVANCE,
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

  // The language check above can't fire when sourceLang is "auto", so an
  // en→en run (or an --out aimed at the input) would write the translation
  // back over the source file. Compare the paths instead — via realpath, since
  // resolve() only joins against cwd and leaves symlinked components alone:
  // on macOS "/tmp/x" and "/private/tmp/x" are one file but two strings.
  if (sameFile(sourcePath, outPath)) {
    throw new TlError(
      "SAME_LOCALE",
      `Output path is the same file as the source: ${sourcePath}`,
      "Pass --to with a different language, or --out with a different path.",
    );
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
  let duplicateKeys: DuplicateKey[] = [];

  try {
    if (parseFormat === "yaml") {
      yamlRead = readYaml(sourcePath);
      sourceData = yamlRead.data;
    } else {
      const r = readJson(sourcePath);
      sourceData = r.data;
      jsonMeta = r.meta;
      duplicateKeys = r.duplicateKeys;
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

  let targetData: JsonValue | undefined;
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
  }

  // Diff against the source re-rooted under the target locale, so sync and
  // target-only key preservation see the target's own root (`fr:`).
  const localeRoot = rebaseLocaleRoot(sourceData, targetData, sourceLocale, targetLang);
  let diffSource = localeRoot?.source ?? sourceData;

  // Rewrite each plural group to the target locale's CLDR categories before the
  // sync diff, so missing-only/--force apply per target category. Runs on the
  // re-rooted source so hint paths match the pending leaf paths. The YAML write
  // template gets the same rewrite so generated keys land where the group was.
  let plurals: PluralRegenResult | undefined;
  if (detected.content === "i18next-plurals") {
    plurals = regenerateI18nextPlurals(diffSource, sourceLang, targetLang);
    diffSource = plurals.data;
    if (yamlRead) regenerateYamlPlurals(yamlRead.doc, sourceLang, targetLang);
  }
  targetData ??= makeEmptyTargetLike(diffSource);

  const pending = diffForSync(diffSource, targetData, mode);

  // Pre-fetch glossary entries once. runPipeline would otherwise re-query SQLite
  // for every leaf — at N leaves with M entries that's N round-trips and N*M row
  // materializations. We hand the entries through PipelineOptions and let the
  // pipeline match them in-process. Same lang-fallback lookup as findMatches uses.
  const glossaryEntries = glossary.lookup(sourceLang, targetLang);

  const summary: FileTranslateSummary = {
    contentFormat: detected.content,
    totalLeaves: pending.length,
    translated: 0,
    skipped: { count: 0, reasons: {} },
    failed: [],
    warnings: [],
    outPath,
    ...(localeRoot && { rootLocaleKey: localeRoot.rename }),
  };

  for (const d of duplicateKeys) {
    summary.warnings.push(
      `Duplicate key "${d.path}" in source (line ${d.line}). The last value wins, matching JSON.parse.`,
    );
  }
  if (localeRoot?.warning) summary.warnings.push(localeRoot.warning);

  if (plurals?.unresolved) {
    summary.warnings.push(
      `Unknown CLDR plural rules for "${targetLang}": i18next plural keys were translated 1:1 from source — review output manually.`,
    );
  }
  // Plural forms whose sample count the model kept rewriting; they were
  // translated from the bare placeholder text, without a number to inflect for.
  const unhinted: string[] = [];

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
    const sentinelHitsFor = (text: string): GlossaryHit[] => {
      const hits: GlossaryHit[] = [];
      for (const ph of placeholders) {
        const tok = sentinelFor(ph.index);
        const idx = text.indexOf(tok);
        if (idx >= 0) {
          hits.push({
            entry: { id: `__sentinel_${ph.index}`, sourceTerm: tok, targetTerm: tok, sourceLang, targetLang },
            startIndex: idx,
            endIndex: idx + tok.length,
          });
        }
      }
      return hits;
    };
    const sentinelHits = sentinelHitsFor(masked);

    // For a plural form, swap {{count}} for the category's sample number so the
    // model inflects for it ("3 files", not "__TLPH_0__ files"); the number is
    // swapped back to the placeholder after translation.
    const hint = plurals?.hints.get(pathKey(p.path));
    const counts = hint ? placeholders.filter((ph) => isCountPlaceholder(ph.raw)) : [];
    let hinted: { text: string; hits: GlossaryHit[]; countTok: string; re: RegExp } | undefined;
    if (hint && counts.length > 0) {
      let text = masked;
      for (const ph of counts) text = text.split(sentinelFor(ph.index)).join(String(hint.value));
      hinted = { text, hits: sentinelHitsFor(text), countTok: sentinelFor(counts[0].index), re: sampleRegex(hint.value, targetLang) };
    }

    const snippets = context.retrieve(p.source, maxSnippets, minRelevance).map((s) => s.content);

    let restored = "";
    let lastReason = "";
    let succeeded = false;

    let usedHint = false;

    for (let attempt = 0; attempt < MAX_PLACEHOLDER_RETRIES; attempt++) {
      const useHint = hinted !== undefined && attempt < PLURAL_HINT_ATTEMPTS;
      let translatedMasked: string;
      try {
        const result = await runPipeline(useHint ? hinted!.text : masked, sourceLang, targetLang, adapter, glossary, {
          glossaryMode,
          contextSnippets: snippets,
          extraGlossaryHits: useHint ? hinted!.hits : sentinelHits,
          glossaryEntries,
        });
        translatedMasked = result.translated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastReason = `Pipeline failed at ${pathStr}: ${msg}`;
        if (continueOnError) break;
        throw err;
      }

      let expected = p.source;
      if (useHint) {
        const swapped = translatedMasked.replace(hinted!.re, hinted!.countTok);
        if (swapped !== translatedMasked) {
          translatedMasked = swapped;
        } else if (hint!.exact) {
          // The category holds only this number (Arabic dual = 2), so a
          // translation that spells it out or drops it ("ملفان") is still right.
          expected = placeholders.filter((ph) => !isCountPlaceholder(ph.raw)).map((ph) => ph.raw).join(" ");
        } else {
          lastReason = `Plural sample count ${hint!.value} not preserved at ${pathStr} (attempt ${attempt + 1}/${PLURAL_HINT_ATTEMPTS})`;
          continue;
        }
      }

      restored = unmask(translatedMasked, placeholders);
      if (placeholders.length === 0) {
        succeeded = true;
        break;
      }
      const v = validate(expected, restored);
      if (v.ok) {
        succeeded = true;
        usedHint = useHint;
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

    if (hinted && !usedHint) unhinted.push(pathStr);
    p.set(restored);
    summary.translated++;
  }
  onProgress?.({ done: pending.length, total: pending.length, path: "" });

  if (unhinted.length > 0) {
    summary.warnings.push(
      `${unhinted.length} plural form(s) were translated without a sample count, so their grammatical number may be wrong — review: ${unhinted.join(", ")}`,
    );
  }

  if (dryRun) return summary;

  // writeJson/writeYaml re-parse the tmp file before the rename, so a malformed
  // serialization never replaces the existing target.
  try {
    if (parseFormat === "yaml") {
      if (localeRoot) renameYamlRootKey(yamlRead!.doc, localeRoot.rename);
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
