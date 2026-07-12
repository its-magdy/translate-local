#!/usr/bin/env bun

import { Command } from "commander";
import { TlError } from "@translate-local/shared/errors";
import { makeTranslateCommand } from "./commands/translate";
import { makeGlossaryCommand } from "./commands/glossary";
import { makeContextCommand } from "./commands/context";
import { makeConfigCommand } from "./commands/config";
import { makeLanguagesCommand } from "./commands/languages";

const program = new Command()
  .name("tl")
  .description("Translation CLI — glossary-aware, context-rich, model-agnostic")
  .version("0.4.1")
  .allowExcessArguments(false);

// `tl <text>` — translate is the default action when a positional argument is passed
const translateCmd = makeTranslateCommand();
program.addCommand(translateCmd);

// Subcommand groups
program.addCommand(makeGlossaryCommand());
program.addCommand(makeContextCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makeLanguagesCommand());

// When called with no args, launch TUI in-process via dynamic import.
// Dynamic import keeps OpenTUI/React off the cold path for non-TUI invocations.
if (process.argv.length <= 2) {
  const { runTui } = await import("@translate-local/tui");
  // runTui() resolves once setup is done; the renderer's stdin raw-mode + render
  // loop keep the event loop alive afterwards, and its teardown() handler is what
  // ultimately calls process.exit(). Do NOT exit here — that would kill the TUI
  // before any user input could be processed.
  try {
    await runTui();
  } catch (err) {
    const msg = err instanceof TlError ? err.hint : String(err);
    console.error(`tl: ${msg}`);
    process.exit(1);
  }
} else {
  // Support: `tl <text>` and `tl --to fr <text>` as shorthand for `tl translate ...`
  // Derive command names dynamically so new subcommands are picked up automatically.
  // Only root-level flags stay with the root program; any other leading flag
  // belongs to translate (previously `tl --to fr "hi"` died with "unknown option").
  const registeredCommands = new Set(program.commands.map((c) => c.name()));
  const rootFlags = new Set(["-h", "--help", "-V", "--version"]);
  const firstArg = process.argv[2];
  if (firstArg && !registeredCommands.has(firstArg) && !rootFlags.has(firstArg)) {
    process.argv.splice(2, 0, "translate");
  }

  program.parseAsync(process.argv).catch((err) => {
    console.error(err.message ?? String(err));
    process.exit(1);
  });
}
