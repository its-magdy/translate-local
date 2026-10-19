import { existsSync, lstatSync, readFileSync, realpathSync } from "fs";
import { extname, resolve, dirname, basename, join } from "path";
import type { Adapter } from "@translate-local/shared/types";
import { TlError, type ErrorTag } from "@translate-local/shared/errors";
import { DEFAULT_MAX_SNIPPETS, DEFAULT_MIN_RELEVANCE } from "@translate-local/shared/constants";
import type { GlossaryStore } from "../glossary";
import type { ContextStore } from "../context";
import { runPipeline } from "../pipeline";
import { detect, resolveParseFormat, type FormatOverride, type ContentFormat, type ParseFormat } from "./detect";
import type { CatalogFormat, SourceCatalog } from "./catalog";
import { jsonFormat } from "./json";
import { yamlFormat } from "./yaml";
import { atomicWriteFile } from "./atomic";
import { diffForSync, pruneTarget, type PendingTranslation, type SyncMode } from "./sync";
import { lockPathFor, readLock, writeLock, hashSource, lockKey, type Checksums } from "./lock";
import { planLeaf, translateLeaf, strictError, isCancelled, type LeafOutcome, type TranslateText } from "./leaf";
import { rebaseLocaleRoot, type RootLocaleRename } from "./locale-root";
import { pathKey } from "./i18next";
import { walkLeaves, type JsonValue } from "./walk";

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
  /** When true, remove target keys / array elements that no longer exist in the source. */
  prune?: boolean;
  /**
   * Prune refuses when it would remove more than half of the target's values,
   * or when source and target share no top-level keys. True overrides both.
   */
  allowLargePrune?: boolean;
  onProgress?: (info: { done: number; total: number; path: string }) => void;
  /**
   * Checked before each leaf and forwarded to the pipeline. Once aborted, no
   * further leaf is translated and an in-flight model call is cancelled (that
   * leaf counts as not reached); the target and lock are still written with the
   * leaves completed so far (not in a dry run) and the summary has
   * `aborted: true`. A CANCELLED pipeline error stops the run the same way,
   * even without a signal here (e.g. a TranslationSession aborted through its
   * adapter): it is never recorded as a failed key.
   */
  signal?: AbortSignal;
};

export type FileTranslateSummary = {
  contentFormat: ContentFormat;
  totalLeaves: number;
  translated: number;
  skipped: { count: number; reasons: Record<string, number> };
  /**
   * `path` is the dotted key path (ambiguous when a key contains a dot);
   * `pointer` is the unambiguous JSON Pointer; `tag` is the error --strict would throw.
   */
  failed: { path: string; pointer: string; tag: ErrorTag; reason: string }[];
  /** Keys re-queued because their source value changed since the last run (per the lock file). */
  changed: string[];
  /** Target paths removed (or that would be, under dryRun) by prune. */
  pruned: string[];
  warnings: string[];
  /** i18next plural forms translated without the sample count meant to set their grammatical number. */
  pluralFallbacks: number;
  /** True when `signal` stopped the run early; the remaining keys were left for the next run. */
  aborted: boolean;
  outPath: string;
  /** Set when the source's root locale key (Rails `en:`) was renamed to the target locale. */
  rootLocaleKey?: RootLocaleRename;
};

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const FORMATS: Record<ParseFormat, CatalogFormat> = { json: jsonFormat, yaml: yamlFormat };

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

function isMap(v: JsonValue): v is { [k: string]: JsonValue } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function countValues(node: JsonValue): number {
  if (node === null || typeof node !== "object") return 1;
  const children = Array.isArray(node) ? node : Object.values(node);
  return children.reduce((n: number, c) => n + countValues(c), 0);
}

// A prune that empties or mostly empties the target almost always means source
// and target don't line up (wrong --out, a Rails root key `en:` vs `ar:`), not
// that the source really lost most of its keys. Runs before any translation or
// write, so a refusal leaves everything untouched; allowLargePrune confirms.
const PRUNE_MAX_FRACTION = 0.5;
const PRUNE_HINT = "Check that --file and --out point at matching catalogs. If the removal is intended, re-run with --allow-large-prune (preview with --dry-run --allow-large-prune).";

function guardPrune(removed: number, total: number, topKeysBefore: string[], after: JsonValue): void {
  if (topKeysBefore.length > 0 && isMap(after) && Object.keys(after).length === 0) {
    const shown = topKeysBefore.slice(0, 3).map((k) => JSON.stringify(k)).join(", ") + (topKeysBefore.length > 3 ? ", ..." : "");
    throw new TlError(
      "PRUNE_REFUSED",
      `--prune refused: the target's top-level keys (${shown}) appear nowhere in the source — source and target share no top-level keys, so every target value would be removed`,
      "A Rails-style catalog keyed by its locale (`en:` in the source, `ar:` in the target) looks like this when the root locale is unknown (--from auto with no locale in the filename); pass --from. " + PRUNE_HINT,
    );
  }
  if (removed / total > PRUNE_MAX_FRACTION) {
    throw new TlError(
      "PRUNE_REFUSED",
      `--prune refused: it would remove ${removed} of ${total} target values (${Math.round((removed / total) * 100)}%, limit ${PRUNE_MAX_FRACTION * 100}%)`,
      PRUNE_HINT,
    );
  }
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
    prune = false,
    allowLargePrune = false,
    onProgress,
    signal,
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

  const catalogFormat = FORMATS[parseFormat];
  let sourceCatalog: SourceCatalog;
  try {
    sourceCatalog = catalogFormat.open(readFileSync(sourcePath, "utf8"));
  } catch (err) {
    if (err instanceof TlError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_PARSE_FAILED", `Failed to parse ${sourcePath}: ${msg}`, "Validate the file with a linter (e.g. `jq .` or `yq .`) before translating.", err);
  }

  const sourceData = sourceCatalog.data;
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
      targetData = catalogFormat.read(readFileSync(outPath, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TlError("FILE_PARSE_FAILED", `Failed to parse existing target ${outPath}: ${msg}`, "Fix or delete the existing target file before re-running.", err);
    }
  }

  // Diff against the source re-rooted under the target locale, so sync and
  // target-only key preservation see the target's own root (`fr:`). Each plural
  // group is rewritten to the target locale's CLDR categories before the sync
  // diff, so missing-only/--force apply per target category; it runs on the
  // re-rooted source so hint paths match the pending leaf paths.
  const localeRoot = rebaseLocaleRoot(sourceData, targetData, sourceLocale, targetLang);
  const target = sourceCatalog.retarget({
    localeRoot,
    plurals: detected.content === "i18next-plurals" ? { sourceLang, targetLang } : undefined,
    existing: targetData,
  });
  const diffSource = target.source;
  const plurals = target.plurals;
  const output = target.output;

  // The lock records the source hash each key was last synced from. No lock
  // (first run) means no change detection: existing target values are trusted.
  // Keys that failed last time are retried while the target still holds the
  // source copied in as their fallback; a value edited since then is kept.
  const lockPath = lockPathFor(outPath);
  const lock = readLock(lockPath);
  const pending = diffForSync(
    diffSource,
    output,
    mode,
    lock ? (path, src) => {
      const prev = lock.checksums[lockKey(path)];
      return prev !== undefined && prev !== hashSource(src);
    } : undefined,
    lock ? (path, existing) => lock.failed[lockKey(path)] === hashSource(existing) : undefined,
  );
  let pruned: (string | number)[][] = [];
  if (prune) {
    const before = countValues(output);
    const topKeysBefore = isMap(output) ? Object.keys(output) : [];
    pruned = pruneTarget(diffSource, output);
    if (!allowLargePrune && pruned.length > 0) {
      guardPrune(before - countValues(output), before, topKeysBefore, output);
    }
  }
  const unsyncedKeys = new Set<string>();

  // Pre-fetch glossary entries once. runPipeline would otherwise re-query SQLite
  // for every leaf — at N leaves with M entries that's N round-trips and N*M row
  // materializations. We hand the entries through PipelineOptions and let the
  // pipeline match them in-process. Same lang-fallback lookup as findMatches uses.
  // With --from auto, the filename's locale (sourceLocale) narrows the lookup
  // to that source language instead of every source language.
  const glossaryEntries = glossary.lookup(sourceLocale ?? sourceLang, targetLang);

  const summary: FileTranslateSummary = {
    contentFormat: detected.content,
    totalLeaves: pending.length,
    translated: 0,
    skipped: { count: 0, reasons: {} },
    failed: [],
    // JSON Pointers (like the lock keys): a dotted key ("nav.home") stays distinct from nav → home.
    changed: pending.filter((p) => p.changed).map((p) => lockKey(p.path)),
    pruned: pruned.map(lockKey),
    warnings: [],
    pluralFallbacks: 0,
    aborted: false,
    outPath,
    ...(localeRoot && { rootLocaleKey: localeRoot.rename }),
  };

  for (const d of sourceCatalog.duplicateKeys) {
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
  if (plurals && plurals.loneOther.length > 0) {
    summary.warnings.push(
      `Found _other keys with no sibling plural forms (${plurals.loneOther.join(", ")}). If the source language has only one plural form (e.g. ja, zh), pass --from <lang> so the target's forms are generated; they were translated 1:1.`,
    );
  }
  // Plural forms translated without the sample count meant to set their
  // grammatical number; listed in a warning for review.
  const unhinted: string[] = [];
  // ICU plural/select values in an i18next catalog, kept as source.
  let icuInI18next = 0;

  // Keys that fell back to their source this run, with the hash of the copied value.
  const failedKeys: Checksums = {};

  // Records a key that could not be translated and falls back to its source.
  // Its lock hash is not refreshed, so a later run still sees a changed source,
  // and it is listed as failed in the lock so the next run retries it.
  const fail = (p: PendingTranslation, pathStr: string, reason: string, tag: ErrorTag): void => {
    summary.failed.push({ path: pathStr, pointer: lockKey(p.path), tag, reason });
    unsyncedKeys.add(lockKey(p.path));
    failedKeys[lockKey(p.path)] = hashSource(p.source);
    if (!dryRun) p.set(p.source);
  };
  // One model call for a translation unit of the leaf at `source`, with that
  // leaf's context snippets (retrieved once per leaf).
  const translatorFor = (source: string): TranslateText => {
    const snippets = context.retrieve(source, maxSnippets, minRelevance).map((s) => s.content);
    return async (text, hits) => {
      const result = await runPipeline(text, sourceLang, targetLang, adapter, glossary, {
        glossaryMode,
        contextSnippets: snippets,
        extraGlossaryHits: hits,
        glossaryEntries,
        signal,
      });
      return result.translated;
    };
  };

  // Leaves pending[i..] were not reached: keep them out of the target and lock.
  const stopAt = (i: number): void => {
    summary.aborted = true;
    summary.warnings.push(`Interrupted: ${pending.length - i} of ${pending.length} key(s) not translated. Re-run to translate them.`);
    // Reverse order, so removing an array element never shifts one still to visit.
    for (const q of pending.slice(i).reverse()) {
      // Their source isn't synced: keep each key's previous lock hash so a
      // changed key is still re-queued next run.
      unsyncedKeys.add(lockKey(q.path));
      target.revertLeaf(q.path);
    }
  };

  for (let i = 0; i < pending.length; i++) {
    if (signal?.aborted) {
      stopAt(i);
      break;
    }
    const p = pending[i];
    const pathStr = p.path.map(String).join(".");
    onProgress?.({ done: i, total: pending.length, path: pathStr });

    const plan = planLeaf(p.source, p.path, pathStr, { content: detected.content, translateAll });
    if (plan.kind === "keep") {
      if (!dryRun) p.set(p.source);
      summary.skipped.count++;
      summary.skipped.reasons[plan.reason] = (summary.skipped.reasons[plan.reason] ?? 0) + 1;
      continue;
    }
    if (plan.kind === "refuse") {
      if (!continueOnError && !dryRun) throw strictError(plan.failure);
      if (plan.icuInI18next) icuInI18next++;
      fail(p, pathStr, dryRun ? plan.reason : plan.failure.message, plan.failure.tag);
      continue;
    }
    if (dryRun) {
      summary.translated++;
      continue;
    }

    let outcome: LeafOutcome;
    try {
      outcome = await translateLeaf(
        p.source,
        pathStr,
        { icu: plan.icu, sourceLang, targetLang, hint: plurals?.hints.get(pathKey(p.path)) },
        translatorFor(p.source),
      );
    } catch (err) {
      if (isCancelled(err)) {
        stopAt(i);
        break;
      }
      throw err;
    }
    if (outcome.kind === "failed") {
      if (!continueOnError) throw strictError(outcome.failure);
      // Fall back to source so every key has a value; user can grep source text to find failures.
      fail(p, pathStr, outcome.failure.message, outcome.failure.tag);
      continue;
    }

    if (outcome.unhinted) unhinted.push(pathStr);
    p.set(outcome.value);
    summary.translated++;
  }
  if (!summary.aborted) onProgress?.({ done: pending.length, total: pending.length, path: "" });

  summary.pluralFallbacks = unhinted.length;
  if (unhinted.length > 0) {
    summary.warnings.push(
      `${unhinted.length} plural form(s) were translated without a sample count (no {{count}} to carry one, or the model kept rewriting it), so their grammatical number may be wrong — review: ${unhinted.join(", ")}`,
    );
  }

  if (icuInI18next > 0) {
    summary.warnings.push(
      `${icuInI18next} value(s) use ICU plural/select syntax, which i18next does not evaluate; kept as source and reported as failed. Later runs report them again until they are rewritten as i18next plural keys.`,
    );
  }

  if (dryRun) return summary;

  // The tmp file is re-parsed before the rename, so a malformed serialization
  // never replaces the existing target.
  try {
    atomicWriteFile(outPath, target.serialize(), (tmp) => { catalogFormat.read(readFileSync(tmp, "utf8")); });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Failed to write ${outPath}: ${msg}`, "Check that the output path is writable.", err);
  }

  // Written after the target so a crash in between only costs a redundant
  // re-translation next run, never a missed one. Entries are rebuilt from the
  // current source, so keys removed from the source drop out. A failed key (or
  // one an abort never reached) keeps its previous hash (if any): when that was
  // a source change, the next run sees the mismatch again and retries it.
  // A key failed this run is recorded as failed; one an abort never reached
  // keeps its previous failed entry. Every other key drops out of `failed`:
  // it was translated, or its target value was edited since it failed.
  const checksums: Checksums = {};
  const failed: Checksums = {};
  for (const leaf of walkLeaves(diffSource)) {
    const key = lockKey(leaf.path);
    if (unsyncedKeys.has(key)) {
      if (lock?.checksums[key] !== undefined) checksums[key] = lock.checksums[key];
      const failedHash = failedKeys[key] ?? lock?.failed[key];
      if (failedHash !== undefined) failed[key] = failedHash;
    } else {
      checksums[key] = hashSource(leaf.value);
    }
  }
  try {
    writeLock(lockPath, checksums, failed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Failed to write ${lockPath}: ${msg}`, "Check that the lock directory is writable.", err);
  }

  return summary;
}
