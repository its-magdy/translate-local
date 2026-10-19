import { Command } from "commander";
import { GlossaryStore } from "@translate-local/core/glossary";
import type { GlossaryEntry } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { readFileSync } from "fs";
import { resolve } from "path";
import { formatGlossaryList } from "../formatters/output";
import { isSupported } from "@translate-local/shared/utils/language";
import { runAction, withStore } from "../utils/run";

/** Wrap a CSV field in double-quotes if it contains a comma, quote, or newline. */
function csvField(s: string): string {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Parse one CSV line, respecting double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      // Quoted field
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ",") i++; // skip comma
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

/** A `|`-separated list of other target forms (`--forms`, the CSV `forms` column). */
function parseForms(value: string | undefined): string[] | undefined {
  const forms = (value ?? "").split("|").map((f) => f.trim()).filter(Boolean);
  return forms.length > 0 ? forms : undefined;
}

function withGlossary<T>(fn: (store: GlossaryStore) => T): Promise<T> {
  return withStore((config) => new GlossaryStore(config.glossary.dbPath), fn);
}

export function makeGlossaryCommand(): Command {
  const cmd = new Command("glossary").description("Manage glossary entries");

  // add
  cmd
    .command("add")
    .description("Add a glossary entry")
    .requiredOption("--source <term>", "Source term")
    .requiredOption("--target <term>", "Target term")
    .requiredOption("--from <lang>", "Source language")
    .requiredOption("--to <lang>", "Target language")
    .option("--domain <domain>", "Domain tag")
    .option("--note <note>", "Usage note")
    .option("--forms <forms>", 'Other target forms that also count as the term, separated by | (a split form such as "stellen … bereit" counts when its parts appear in order in one sentence)')
    .action((opts: { source: string; target: string; from: string; to: string; domain?: string; note?: string; forms?: string }) => runAction(async () => {
      for (const lang of [opts.from, opts.to]) {
        if (!isSupported(lang)) {
          throw new TlError("INVALID_LANGUAGE", `Unsupported language code: "${lang}"`, "Run `tl config status` to see supported codes.");
        }
      }
      const entry = await withGlossary((store) =>
        store.add({
          sourceTerm: opts.source,
          targetTerm: opts.target,
          sourceLang: opts.from,
          targetLang: opts.to,
          domain: opts.domain,
          note: opts.note,
          forms: parseForms(opts.forms),
        }),
      );
      const forms = entry.forms ? ` (also: ${entry.forms.join(" | ")})` : "";
      console.log(`Added: ${entry.sourceTerm} → ${entry.targetTerm}${forms} (${entry.id.slice(0, 8)})`);
    }));

  // list
  cmd
    .command("list")
    .description("List glossary entries")
    .option("--from <lang>", "Filter by source language")
    .option("--to <lang>", "Filter by target language")
    .option("--domain <domain>", "Filter by domain")
    .option("--json", "Output JSON")
    .action((opts: { from?: string; to?: string; domain?: string; json?: boolean }) => runAction(async () => {
      let entries = await withGlossary((store) => store.list(opts.from, opts.to));
      if (opts.domain) entries = entries.filter((e) => e.domain === opts.domain);
      console.log(formatGlossaryList(entries, opts.json ?? false));
    }, { json: opts.json }));

  // remove
  cmd
    .command("remove <id>")
    .description("Remove a glossary entry by ID (or ID prefix)")
    .action((id: string) => runAction(async () => {
      const removed = await withGlossary((store) => store.removeByIdOrPrefix(id));
      console.log(`Removed entry ${removed}`);
    }));

  // import
  cmd
    .command("import <file>")
    .description("Import entries from CSV (source,target,from,to[,domain][,note][,forms])")
    .action((file: string) => runAction(async () => {
      const resolvedFile = resolve(file);
      const lines = readFileSync(resolvedFile, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      const entries: Omit<GlossaryEntry, "id">[] = [];
      for (const line of lines) {
        const [sourceTerm, targetTerm, sourceLang, targetLang, domain, note, forms] = parseCsvLine(line).map((s) => s.trim());
        if (!sourceTerm || !targetTerm || !sourceLang || !targetLang) continue;
        // Skip header rows (e.g. "source,target,from,to,..." or "source,target,source_lang,...")
        if (sourceTerm === "source" && targetTerm === "target") continue;
        if (!isSupported(sourceLang) || !isSupported(targetLang)) {
          console.error(`Skipping row with unsupported language: "${sourceLang}" → "${targetLang}"`);
          continue;
        }
        entries.push({ sourceTerm, targetTerm, sourceLang, targetLang, domain: domain || undefined, note: note || undefined, forms: parseForms(forms) });
      }
      // One transaction for the whole file — per-row inserts pay a commit each.
      const added = await withGlossary((store) => store.addMany(entries));
      console.log(`Imported ${added} entries`);
    }));

  // export
  cmd
    .command("export")
    .description("Export glossary to CSV or JSON")
    .option("--from <lang>", "Filter by source language")
    .option("--to <lang>", "Filter by target language")
    .option("--json", "Export as JSON (default: CSV)")
    .action((opts: { from?: string; to?: string; json?: boolean }) => runAction(async () => {
      const entries = await withGlossary((store) => store.list(opts.from, opts.to));
      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        console.log("source,target,from,to,domain,note,forms");
        for (const e of entries) {
          console.log([e.sourceTerm, e.targetTerm, e.sourceLang, e.targetLang, e.domain ?? "", e.note ?? "", (e.forms ?? []).join("|")].map(csvField).join(","));
        }
      }
    }, { json: opts.json }));

  return cmd;
}
