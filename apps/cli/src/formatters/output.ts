import type { TranslationResult } from "@tl/shared/types";
import type { GlossaryEntry } from "@tl/shared/types";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function color(s: string, c: string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined) return s;
  return `${c}${s}${RESET}`;
}

export function formatTranslationResult(result: TranslationResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(result.translated);

  const pct = Math.round(result.glossaryCoverage * 100);
  const covStr = result.missingTerms.length === 0
    ? color(`Glossary: ${pct}% covered ✓`, GREEN)
    : color(`Glossary: ${pct}% covered (missing: ${result.missingTerms.join(", ")})`, YELLOW);

  if (result.metadata.retries > 0) {
    lines.push(color(`  retried ${result.metadata.retries}x`, DIM));
  }
  lines.push(color(`  ${result.metadata.adapter} · ${result.metadata.durationMs}ms`, DIM));
  lines.push(covStr);

  return lines.join("\n");
}

export function formatGlossaryList(entries: GlossaryEntry[], json: boolean): string {
  if (json) return JSON.stringify(entries, null, 2);
  if (entries.length === 0) return color("No glossary entries found.", DIM);

  const rows = entries.map((e) => {
    const domain = e.domain ? color(` [${e.domain}]`, CYAN) : "";
    const note = e.note ? color(` — ${e.note}`, DIM) : "";
    return `  ${color(e.id.slice(0, 8), DIM)}  ${color(e.sourceTerm, BOLD)} → ${e.targetTerm}  ${e.sourceLang}→${e.targetLang}${domain}${note}`;
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
