import { Argument, Command } from "commander";
import { generateBash } from "../completions/bash";
import { generateZsh } from "../completions/zsh";
import { SUPPORTED_SHELLS, type SupportedShell } from "../completions/spec";

export function makeCompletionCommand(): Command {
  return new Command("completion")
    .description("Generate shell completion script (bash, zsh, fish)")
    .addArgument(new Argument("<shell>", "Shell to generate completions for").choices([...SUPPORTED_SHELLS]))
    .addHelpText(
      "after",
      `
Examples:
  $ eval "$(tl completion bash)"                          # bash, current shell
  $ tl completion bash >> ~/.bashrc                       # bash, persistent
  $ tl completion zsh > "\${fpath[1]}/_tl"                # zsh
  $ tl completion fish > ~/.config/fish/completions/tl.fish
`,
    )
    .action((shell: SupportedShell) => {
      switch (shell) {
        case "bash":
          process.stdout.write(generateBash());
          return;
        case "zsh":
          process.stdout.write(generateZsh());
          return;
        case "fish":
          // Wired in follow-up commit.
          console.error(`tl: completion for ${shell} is not yet available`);
          process.exit(1);
      }
    });
}
