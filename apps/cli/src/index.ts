#!/usr/bin/env bun

import { Command } from "commander";
import { makeTranslateCommand } from "./commands/translate";
import { makeGlossaryCommand } from "./commands/glossary";
import { makeContextCommand } from "./commands/context";
import { makeConfigCommand } from "./commands/config";

const program = new Command()
  .name("tl")
  .description("Translation CLI — glossary-aware, context-rich, model-agnostic")
  .version("0.2.0")
  .allowExcessArguments(false);

// `tl <text>` — translate is the default action when a positional argument is passed
const translateCmd = makeTranslateCommand();
program.addCommand(translateCmd);

// Subcommand groups
program.addCommand(makeGlossaryCommand());
program.addCommand(makeContextCommand());
program.addCommand(makeConfigCommand());

// When called with no args, launch TUI in-process via dynamic import.
// Dynamic import keeps OpenTUI/React off the cold path for non-TUI invocations.
if (process.argv.length <= 2) {
  const { runTui } = await import("@tl/tui");
  await runTui();
  process.exit(0);
}

// Support: `tl <text>` as shorthand for `tl translate <text>`
// Derive command names dynamically so new subcommands are picked up automatically.
const registeredCommands = new Set(program.commands.map((c) => c.name()));
const firstArg = process.argv[2];
if (firstArg && !registeredCommands.has(firstArg) && !firstArg.startsWith("-")) {
  process.argv.splice(2, 0, "translate");
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message ?? String(err));
  process.exit(1);
});
