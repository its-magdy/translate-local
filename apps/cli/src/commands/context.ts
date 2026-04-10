import { Command } from "commander";
import { resolve } from "path";
import { loadConfig } from "@translate-local/core/config";
import { ContextStore } from "@translate-local/core/context";
import { formatError } from "../formatters/output";

async function withStore<T>(fn: (s: ContextStore) => Promise<T>): Promise<T> {
  const config = loadConfig();
  let store: ContextStore | undefined;
  try {
    store = new ContextStore(config.context.dbPath);
    return await fn(store);
  } finally {
    store?.close();
  }
}

export function makeContextCommand(): Command {
  const cmd = new Command("context").description("Manage context sources");

  cmd
    .command("add <path>")
    .description("Add a directory as context source")
    .action(async (path: string) => {
      try {
        const source = await withStore(async (store) => store.addSource(path));
        console.log(`Added: ${source.path} (${source.fileCount} files, id: ${source.id.slice(0, 8)})`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List context sources")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const sources = await withStore(async (store) => store.listSources());
        if (opts.json) {
          console.log(JSON.stringify(sources, null, 2));
        } else if (sources.length === 0) {
          console.log("No context sources.");
        } else {
          for (const s of sources) {
            console.log(`${s.id.slice(0, 8)}  ${s.path}  (${s.fileCount} files, indexed: ${s.indexedAt ?? "never"})`);
          }
        }
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  cmd
    .command("remove <path>")
    .description("Remove a context source by path")
    .action(async (path: string) => {
      try {
        await withStore(async (store) => {
          const sources = store.listSources();
          const normalizedInput = resolve(path);
          const match = sources.find((s) => resolve(s.path) === normalizedInput);
          if (!match) throw new Error(`No context source found for path: ${path}`);
          store.removeSource(match.id);
        });
        console.log(`Removed context source: ${path}`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  cmd
    .command("index")
    .description("Re-index all context sources")
    .action(async () => {
      try {
        await withStore(async (store) => store.reindex());
        console.log("Re-indexed all context sources.");
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  return cmd;
}
