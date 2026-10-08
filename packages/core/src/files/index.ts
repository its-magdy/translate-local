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
import { diffForSync, makeEmptyTargetLike, pruneTarget, type SyncMode } from "./sync";
import { lockPathFor, readLock, writeLock, hashSource, lockKey, type Checksums } from "./lock";
import { mask, unmask, validate, containsICU, containsICUBranching, sentinelFor, sentinelIndices } from "./placeholders";
import { parseICU, translateICU, type UnitTranslator } from "./icu";
import { classifyValue } from "./skip";
import { rebaseLocaleRoot, renameYamlRootKey, type RootLocaleRename } from "./locale-root";
import { regenerateI18nextPlurals, regenerateYamlPlurals, pathKey, isCountPlaceholder, type PluralRegenResult } from "./i18next";
import { sampleRegex } from "./plurals";
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
};

export type FileTranslateSummary = {
  contentFormat: ContentFormat;
  totalLeaves: number;
  translated: number;
  skipped: { count: number; reasons: Record<string, number> };
  failed: { path: string; reason: string }[];
  /** Keys re-queued because their source value changed since the last run (per the lock file). */
  changed: string[];
  /** Target paths removed (or that would be, under dryRun) by prune. */
  pruned: string[];
  warnings: string[];
  /** i18next plural forms translated without the sample count meant to set their grammatical number. */
  pluralFallbacks: number;
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

/** A leaf that could not be translated; recorded as failed (or thrown under --strict). */
class UnitFailed extends Error {
  constructor(
    message: string,
    /** Set when the pipeline itself threw; rethrown as-is under --strict. */
    readonly pipelineError?: unknown,
    readonly tag: "PLACEHOLDER_MISMATCH" | "FILE_INVALID_FORMAT" = "PLACEHOLDER_MISMATCH",
  ) {
    super(message);
  }
}

// translategemma reliably honors <term> tags from the glossary path; routing
// sentinels through that channel preserves them better than naked-token instructions.
function sentinelHits(masked: string, sourceLang: string, targetLang: string): GlossaryHit[] {
  const hits: GlossaryHit[] = [];
  for (const index of sentinelIndices(masked)) {
    const tok = sentinelFor(index);
    const idx = masked.indexOf(tok);
    hits.push({
      entry: { id: `__sentinel_${index}`, sourceTerm: tok, targetTerm: tok, sourceLang, targetLang },
      startIndex: idx,
      endIndex: idx + tok.length,
    });
  }
  return hits;
}

function parsesAsICU(source: string): boolean {
  try {
    parseICU(source);
    return true;
  } catch {
    return false;
  }
}

async function translateIcuLeaf(source: string, pathStr: string, targetLang: string, runUnit: UnitTranslator): Promise<string> {
  try {
    parseICU(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UnitFailed(`Invalid ICU MessageFormat at ${pathStr}: ${msg}`, undefined, "FILE_INVALID_FORMAT");
  }
  try {
    return await translateICU(source, targetLang, runUnit);
  } catch (err) {
    if (err instanceof UnitFailed) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new UnitFailed(`ICU validation failed at ${pathStr}: ${msg}`);
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


  // The lock records the source hash each key was last synced from. No lock
  // (first run) means no change detection: existing target values are trusted.
  const lockPath = lockPathFor(outPath);
  const lock = readLock(lockPath);
  const pending = diffForSync(
    diffSource,
    targetData,
    mode,
    lock ? (path, src) => {
      const prev = lock[lockKey(path)];
      return prev !== undefined && prev !== hashSource(src);
    } : undefined,
  );
  let pruned: (string | number)[][] = [];
  if (prune) {
    const before = countValues(targetData);
    const topKeysBefore = isMap(targetData) ? Object.keys(targetData) : [];
    pruned = pruneTarget(diffSource, targetData);
    if (!allowLargePrune && pruned.length > 0) {
      guardPrune(before - countValues(targetData), before, topKeysBefore, targetData);
    }
  }
  const failedKeys = new Set<string>();

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
    // JSON Pointers (like the lock keys): a dotted key ("nav.home") stays distinct from nav → home.
    changed: pending.filter((p) => p.changed).map((p) => lockKey(p.path)),
    pruned: pruned.map(lockKey),
    warnings: [],
    pluralFallbacks: 0,
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
  if (plurals && plurals.loneOther.length > 0) {
    summary.warnings.push(
      `Found _other keys with no sibling plural forms (${plurals.loneOther.join(", ")}). If the source language has only one plural form (e.g. ja, zh), pass --from <lang> so the target's forms are generated; they were translated 1:1.`,
    );
  }
  // Plural forms translated without the sample count meant to set their
  // grammatical number; listed in a warning for review.
  const unhinted: string[] = [];
  // ICU plural/select values in an i18next catalog, kept as source.
  const icuInI18next: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const pathStr = p.path.map(String).join(".");
    onProgress?.({ done: i, total: pending.length, path: pathStr });

    // FormatJS: only defaultMessage is a message; description and friends are
    // notes for translators and are copied verbatim.
    if (detected.content === "formatjs" && p.path[p.path.length - 1] !== "defaultMessage") {
      if (!dryRun) p.set(p.source);
      summary.skipped.count++;
      summary.skipped.reasons.metadata = (summary.skipped.reasons.metadata ?? 0) + 1;
      continue;
    }

    if (!translateAll) {
      const cls = classifyValue(p.source);
      if (cls.skip) {
        if (!dryRun) p.set(p.source);
        summary.skipped.count++;
        summary.skipped.reasons[cls.reason] = (summary.skipped.reasons[cls.reason] ?? 0) + 1;
        continue;
      }
    }

    // i18next doesn't speak ICU: a single-brace "{x, number}" there is literal text.
    const isICU = detected.content === "formatjs" || (detected.content !== "i18next-plurals" && containsICU(p.source));

    // A plural/select in an i18next catalog would reach the model as literal
    // text and come back garbled, so keep the source and report it.
    if (detected.content === "i18next-plurals" && containsICUBranching(p.source)) {
      const reason = `ICU MessageFormat in an i18next catalog at ${pathStr}`;
      if (!continueOnError) {
        throw new TlError(
          "FILE_INVALID_FORMAT",
          reason,
          "i18next does not evaluate ICU plural/select, so the value is not translated. Use i18next plural keys (key_one, key_other) or i18next-icu; the default run keeps the source for these keys.",
        );
      }
      summary.failed.push({ path: pathStr, reason });
      failedKeys.add(lockKey(p.path));
      icuInI18next.push(pathStr);
      if (!dryRun) p.set(p.source);
      continue;
    }

    if (dryRun) {
      if (isICU && !parsesAsICU(p.source)) {
        summary.failed.push({ path: pathStr, reason: `Invalid ICU MessageFormat at ${pathStr}` });
      } else {
        summary.translated++;
      }
      continue;
    }

    const snippets = context.retrieve(p.source, maxSnippets, minRelevance).map((s) => s.content);

    if (isICU) {
      // Runs the pipeline on `masked` until `check` accepts the output (null =
      // accepted), retrying placeholder failures. Throws UnitFailed on give-up.
      const runUnit: UnitTranslator = async (masked, check) => {
        const hits = sentinelHits(masked, sourceLang, targetLang);
        let lastReason = "";
        for (let attempt = 0; attempt < MAX_PLACEHOLDER_RETRIES; attempt++) {
          let translated: string;
          try {
            const result = await runPipeline(masked, sourceLang, targetLang, adapter, glossary, {
              glossaryMode,
              contextSnippets: snippets,
              extraGlossaryHits: hits,
              glossaryEntries,
            });
            translated = result.translated;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new UnitFailed(`Pipeline failed at ${pathStr}: ${msg}`, err);
          }
          const problem = check(translated);
          if (problem === null) return translated;
          lastReason = `Placeholder mismatch at ${pathStr} (attempt ${attempt + 1}/${MAX_PLACEHOLDER_RETRIES}) — ${problem}`;
        }
        throw new UnitFailed(lastReason);
      };

      let translatedValue: string;
      try {
        translatedValue = await translateIcuLeaf(p.source, pathStr, targetLang, runUnit);
      } catch (err) {
        if (!(err instanceof UnitFailed)) throw err;
        if (continueOnError) {
          // Fall back to source so every key has a value; user can grep source text to find failures.
          summary.failed.push({ path: pathStr, reason: err.message });
          failedKeys.add(lockKey(p.path));
          p.set(p.source);
          continue;
        }
        if (err.pipelineError !== undefined) throw err.pipelineError;
        throw new TlError(
          err.tag,
          err.message,
          err.tag === "FILE_INVALID_FORMAT"
            ? "Fix the ICU syntax in the source value. The default run continues and falls back to source for these keys; --strict aborts instead."
            : "The model output dropped or altered placeholders across all retries. Pass --strict only if you want abort-on-failure; otherwise the default continues with source-as-fallback.",
        );
      }
      p.set(translatedValue);
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
    const maskedHits = sentinelHitsFor(masked);

    // For a plural form, swap {{count}} for the category's sample number so the
    // model inflects for it ("3 files", not "__TLPH_0__ files"); the number is
    // swapped back to the placeholder after translation.
    const hint = plurals?.hints.get(pathKey(p.path));
    const counts = hint ? placeholders.filter((ph) => isCountPlaceholder(ph.raw)) : [];
    // A form that should have had a sample but can't: no {{count}} in its text
    // (and the category spans several numbers), or every sample collides with
    // a literal number in the text (hint === null).
    const hintMissed = hint === null || (hint !== undefined && counts.length === 0 && !hint.exact);
    let hinted: { text: string; hits: GlossaryHit[]; countTok: string; re: RegExp } | undefined;
    if (hint && counts.length > 0) {
      let text = masked;
      for (const ph of counts) text = text.split(sentinelFor(ph.index)).join(String(hint.value));
      // Markup stays raw in the hinted text: translategemma keeps `<b>3</b>`
      // but drops sentinels glued to a bare number (`__TLPH_0__3__TLPH_2__`).
      // Raw tags in the output still pass validate(), which compares raw forms.
      for (const ph of placeholders) {
        if (ph.raw.startsWith("<")) text = text.split(sentinelFor(ph.index)).join(ph.raw);
      }
      hinted = { text, hits: sentinelHitsFor(text), countTok: sentinelFor(counts[0].index), re: sampleRegex(hint.value, targetLang) };
    }

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
          extraGlossaryHits: useHint ? hinted!.hits : maskedHits,
          glossaryEntries,
        });
        translatedMasked = result.translated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastReason = `Pipeline failed at ${pathStr}: ${msg}`;
        // A sample count can derail the model (e.g. Ollama aborting on a
        // repeated "0" token for 1000000) — move on to the plain text instead.
        if (useHint && !(err instanceof TlError && err.tag === "ADAPTER_UNAVAILABLE")) continue;
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
        failedKeys.add(lockKey(p.path));
        p.set(p.source);
        continue;
      }
      throw new TlError(
        "PLACEHOLDER_MISMATCH",
        lastReason,
        "The model output dropped or altered placeholders across all retries. Pass --strict only if you want abort-on-failure; otherwise the default continues with source-as-fallback.",
      );
    }

    if ((hinted && !usedHint) || hintMissed) unhinted.push(pathStr);
    p.set(restored);
    summary.translated++;
  }
  onProgress?.({ done: pending.length, total: pending.length, path: "" });

  summary.pluralFallbacks = unhinted.length;
  if (unhinted.length > 0) {
    summary.warnings.push(
      `${unhinted.length} plural form(s) were translated without a sample count (no {{count}} to carry one, or the model kept rewriting it), so their grammatical number may be wrong — review: ${unhinted.join(", ")}`,
    );
  }

  if (icuInI18next.length > 0) {
    summary.warnings.push(
      `${icuInI18next.length} value(s) use ICU plural/select syntax, which i18next does not evaluate; kept as source, not translated: ${icuInI18next.join(", ")}`,
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

  // Written after the target so a crash in between only costs a redundant
  // re-translation next run, never a missed one. Entries are rebuilt from the
  // current source, so keys removed from the source drop out. A failed key
  // keeps its previous hash (if any): when that was a source change, the next
  // run sees the mismatch again and retries it.
  const checksums: Checksums = {};
  for (const leaf of walkLeaves(diffSource)) {
    const key = lockKey(leaf.path);
    if (failedKeys.has(key)) {
      if (lock?.[key] !== undefined) checksums[key] = lock[key];
    } else {
      checksums[key] = hashSource(leaf.value);
    }
  }
  try {
    writeLock(lockPath, checksums);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_WRITE_FAILED", `Failed to write ${lockPath}: ${msg}`, "Check that the lock directory is writable.", err);
  }

  return summary;
}
