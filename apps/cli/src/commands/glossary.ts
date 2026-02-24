import { Command } from "commander";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { readFileSync } from "fs";
import { formatGlossaryList, formatError } from "../formatters/output";

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

function withStore<T>(fn: (store: GlossaryStore) => T): T {
  const config = loadConfig();
  const store = new GlossaryStore(config.glossary.dbPath);
  try {
    return fn(store);
  } finally {
    store.close();
  }
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
    .action((opts: { source: string; target: string; from: string; to: string; domain?: string; note?: string }) => {
      try {
        const entry = withStore((store) =>
          store.add({
            sourceTerm: opts.source,
            targetTerm: opts.target,
            sourceLang: opts.from,
            targetLang: opts.to,
            domain: opts.domain,
            note: opts.note,
          }),
        );
        console.log(`Added: ${entry.sourceTerm} → ${entry.targetTerm} (${entry.id.slice(0, 8)})`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // list
  cmd
    .command("list")
    .description("List glossary entries")
    .option("--from <lang>", "Filter by source language")
    .option("--to <lang>", "Filter by target language")
    .option("--domain <domain>", "Filter by domain")
    .option("--json", "Output JSON")
    .action((opts: { from?: string; to?: string; domain?: string; json?: boolean }) => {
      try {
        let entries = withStore((store) => store.list(opts.from, opts.to));
        if (opts.domain) entries = entries.filter((e) => e.domain === opts.domain);
        console.log(formatGlossaryList(entries, opts.json ?? false));
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // remove
  cmd
    .command("remove <id>")
    .description("Remove a glossary entry by ID (or ID prefix)")
    .action((id: string) => {
      try {
        const removed = withStore((store) => {
          const all = store.list();
          const match = all.find((e) => e.id === id || e.id.startsWith(id));
          if (!match) return false;
          return store.remove(match.id);
        });
        if (removed) {
          console.log(`Removed entry ${id}`);
        } else {
          console.error(`No entry found with id: ${id}`);
          process.exit(1);
        }
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // import
  cmd
    .command("import <file>")
    .description("Import entries from CSV (source,target,from,to[,domain][,note])")
    .action((file: string) => {
      try {
        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
        let added = 0;
        withStore((store) => {
          for (const line of lines) {
            const [sourceTerm, targetTerm, sourceLang, targetLang, domain, note] = parseCsvLine(line).map((s) => s.trim());
            if (!sourceTerm || !targetTerm || !sourceLang || !targetLang) continue;
            store.add({ sourceTerm, targetTerm, sourceLang, targetLang, domain: domain || undefined, note: note || undefined });
            added++;
          }
        });
        console.log(`Imported ${added} entries`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // export
  cmd
    .command("export")
    .description("Export glossary to CSV or JSON")
    .option("--from <lang>", "Filter by source language")
    .option("--to <lang>", "Filter by target language")
    .option("--json", "Export as JSON (default: CSV)")
    .action((opts: { from?: string; to?: string; json?: boolean }) => {
      try {
        const entries = withStore((store) => store.list(opts.from, opts.to));
        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log("source,target,from,to,domain,note");
          for (const e of entries) {
            console.log([e.sourceTerm, e.targetTerm, e.sourceLang, e.targetLang, e.domain ?? "", e.note ?? ""].map(csvField).join(","));
          }
        }
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  return cmd;
}
