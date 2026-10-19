import type { TranslationResult } from "@translate-local/shared/types";
import type { GlossaryEntry } from "@translate-local/shared/types";
import type { FileTranslateSummary } from "@translate-local/core/files";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function color(s: string, c: string, stream: NodeJS.WriteStream = process.stdout): string {
  if (!stream.isTTY || process.env.NO_COLOR !== undefined) return s;
  return `${c}${s}${RESET}`;
}

// `stream` is the stream the caller will write to — color must gate on ITS
// TTY-ness (metadata goes to stderr, so gating on stdout would leak ANSI codes
// into redirected stderr logs). includeTranslation: false emits metadata only,
// for callers that already streamed the translation to stdout. The coverage
// line is omitted when no glossary term matched (coverage then reads 100%).
export function formatTranslationResult(
  result: TranslationResult,
  json: boolean,
  stream: NodeJS.WriteStream = process.stdout,
  { includeTranslation = true } = {},
): string {
  if (json) return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  if (includeTranslation) lines.push(result.translated);

  if (result.metadata.retries > 0) {
    lines.push(color(`  retried ${result.metadata.retries}x`, DIM, stream));
  }
  lines.push(color(`  ${result.metadata.adapter} · ${result.metadata.durationMs}ms`, DIM, stream));

  if (result.glossaryTerms > 0) {
    const pct = Math.round(result.glossaryCoverage * 100);
    lines.push(result.missingTerms.length === 0
      ? color(`Glossary: ${pct}% covered ✓`, GREEN, stream)
      : color(`Glossary: ${pct}% covered (missing: ${result.missingTerms.join(", ")})`, YELLOW, stream));
  }

  return lines.join("\n");
}

export function formatGlossaryList(entries: GlossaryEntry[], json: boolean): string {
  if (json) return JSON.stringify(entries, null, 2);
  if (entries.length === 0) return color("No glossary entries found.", DIM);

  const rows = entries.map((e) => {
    const domain = e.domain ? color(` [${e.domain}]`, CYAN) : "";
    const note = e.note ? color(` — ${e.note}`, DIM) : "";
    const forms = e.forms ? color(` (also: ${e.forms.join(" | ")})`, DIM) : "";
    return `  ${color(e.id.slice(0, 8), DIM)}  ${color(e.sourceTerm, BOLD)} → ${e.targetTerm}${forms}  ${e.sourceLang}→${e.targetLang}${domain}${note}`;
  });

  return [color(`${entries.length} entr${entries.length === 1 ? "y" : "ies"}:`, BOLD), ...rows].join("\n");
}

export function formatError(err: unknown): string {
  if (err && typeof err === "object" && "tag" in err) {
    const e = err as { tag: string; message: string; hint?: string };
    const lines = [color(`Error [${e.tag}]: ${e.message}`, RED)];
    if (e.hint) lines.push(color(`Hint: ${e.hint}`, YELLOW));
    return lines.join("\n");
  }
  return color(`Error: ${String(err)}`, RED);
}

/** The --json error shape: `{ error: <tag>, message, hint }` (hint null when absent). */
export function formatErrorJson(err: unknown): string {
  if (err && typeof err === "object" && "tag" in err) {
    const e = err as { tag: string; message: string; hint?: string };
    return JSON.stringify({ error: e.tag, message: e.message, hint: e.hint ?? null });
  }
  return JSON.stringify({ error: "TRANSLATION_FAILED", message: String(err), hint: null });
}

// The human-readable summary of a file run: counts on stdout, per-key failures
// and warnings on stderr. A dry run lists what would change instead.
export function formatFileSummary(
  result: FileTranslateSummary,
  sourcePath: string,
  { dryRun, prune }: { dryRun: boolean; prune: boolean },
): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr = result.warnings.map((w) => `Warning: ${w}`);
  if (dryRun) {
    stdout.push(`[dry-run] Source: ${sourcePath}`);
    stdout.push(`[dry-run] Target: ${result.outPath} (NOT written)`);
    stdout.push(`[dry-run] Format: ${result.contentFormat}`);
    if (result.rootLocaleKey) stdout.push(`[dry-run] Root locale key: ${result.rootLocaleKey.from} -> ${result.rootLocaleKey.to}`);
    stdout.push(`[dry-run] Would translate: ${result.translated}`);
    if (result.skipped.count > 0) stdout.push(`[dry-run] Would skip: ${result.skipped.count}`);
    if (result.changed.length > 0) {
      stdout.push(`[dry-run] Source changed: ${result.changed.length}`);
      for (const p of result.changed) stdout.push(`  ${p}`);
    }
    if (prune) {
      stdout.push(`[dry-run] Would prune: ${result.pruned.length}`);
      for (const p of result.pruned) stdout.push(`  ${p}`);
    }
    return { stdout, stderr };
  }
  stdout.push(`Wrote ${result.outPath}`);
  stdout.push(`Format: ${result.contentFormat}`);
  if (result.rootLocaleKey) stdout.push(`Root locale key: ${result.rootLocaleKey.from} -> ${result.rootLocaleKey.to}`);
  stdout.push(`Translated: ${result.translated} / ${result.totalLeaves}`);
  if (result.changed.length > 0) stdout.push(`Source changed: ${result.changed.length}`);
  if (prune) stdout.push(`Pruned: ${result.pruned.length}`);
  if (result.skipped.count > 0) {
    const reasons = Object.entries(result.skipped.reasons).map(([r, n]) => `${r}=${n}`).join(", ");
    stdout.push(`Skipped: ${result.skipped.count} (${reasons})`);
  }
  if (result.failed.length > 0) {
    stdout.push(`Failed: ${result.failed.length} (source value used as fallback — search the output for un-translated source text)`);
    stderr.unshift(...result.failed.map((f) => `  ${f.path}: ${f.reason}`));
  }
  return { stdout, stderr };
}
