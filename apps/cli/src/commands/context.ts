import { Command } from "commander";

// Context system is implemented in Phase 5.
// These subcommands are registered now so the CLI structure is complete,
// but will print a "not yet available" message until Phase 5 is done.

function notYet(subcmd: string): void {
  console.error(`tl context ${subcmd}: context system not yet available (Phase 5)`);
  process.exit(1);
}

export function makeContextCommand(): Command {
  const cmd = new Command("context").description("Manage context sources");

  cmd.command("add <path>").description("Add a directory as context source").action(() => notYet("add"));
  cmd.command("list").description("List context sources").action(() => notYet("list"));
  cmd.command("remove <path>").description("Remove a context source").action(() => notYet("remove"));
  cmd.command("index").description("Re-index all context sources").action(() => notYet("index"));

  return cmd;
}
