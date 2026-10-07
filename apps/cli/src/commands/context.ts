import { Command } from "commander";
import { resolve } from "path";
import { ContextStore } from "@translate-local/core/context";
import { runAction, withStore } from "../utils/run";

function withContext<T>(fn: (s: ContextStore) => T | Promise<T>): Promise<T> {
  return withStore((config) => new ContextStore(config.context.dbPath), fn);
}

export function makeContextCommand(): Command {
  const cmd = new Command("context").description("Manage context sources");

  cmd
    .command("add <path>")
    .description("Add a directory as context source")
    .action((path: string) => runAction(async () => {
      const source = await withContext((store) => store.addSource(path));
      console.log(`Added: ${source.path} (${source.fileCount} files, id: ${source.id.slice(0, 8)})`);
    }));

  cmd
    .command("list")
    .description("List context sources")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => runAction(async () => {
      const sources = await withContext((store) => store.listSources());
      if (opts.json) {
        console.log(JSON.stringify(sources, null, 2));
      } else if (sources.length === 0) {
        console.log("No context sources.");
      } else {
        for (const s of sources) {
          console.log(`${s.id.slice(0, 8)}  ${s.path}  (${s.fileCount} files, indexed: ${s.indexedAt ?? "never"})`);
        }
      }
    }));

  cmd
    .command("remove <path>")
    .description("Remove a context source by path")
    .action((path: string) => runAction(async () => {
      await withContext((store) => {
        const sources = store.listSources();
        const normalizedInput = resolve(path);
        const match = sources.find((s) => resolve(s.path) === normalizedInput);
        if (!match) throw new Error(`No context source found for path: ${path}`);
        store.removeSource(match.id);
      });
      console.log(`Removed context source: ${path}`);
    }));

  cmd
    .command("index")
    .description("Re-index all context sources")
    .action(() => runAction(async () => {
      await withContext((store) => store.reindex());
      console.log("Re-indexed all context sources.");
    }));

  return cmd;
}
