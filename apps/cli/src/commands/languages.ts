import { Command } from "commander";
import { LANG_NAMES } from "@translate-local/shared/constants";

export function makeLanguagesCommand(): Command {
  return new Command("languages")
    .description("List all supported language codes and names")
    .option("--json", "Output as JSON")
    .action((opts) => {
      if (opts.json) {
        console.log(JSON.stringify(LANG_NAMES, null, 2));
        return;
      }
      const entries = Object.entries(LANG_NAMES);
      const codeWidth = Math.max(...entries.map(([code]) => code.length));
      for (const [code, name] of entries) {
        console.log(`  ${code.padEnd(codeWidth)}  ${name}`);
      }
    });
}
