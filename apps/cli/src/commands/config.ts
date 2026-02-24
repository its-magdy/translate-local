import { Command } from "commander";
import { loadConfig, saveConfig } from "@tl/core/config";
import { formatError } from "../formatters/output";
import { join } from "path";
import { homedir } from "os";

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Manage tl configuration");

  // connect — set adapter backend and credentials
  cmd
    .command("connect")
    .description("Configure adapter backend")
    .option("--backend <type>", "Adapter backend: local | huggingface", "local")
    .option("--model <name>", "Model name")
    .option("--endpoint <url>", "Ollama endpoint URL (local backend)")
    .option("--hf-token <token>", "HuggingFace API token")
    .action((opts: { backend: string; model?: string; endpoint?: string; hfToken?: string }) => {
      try {
        const config = loadConfig();

        if (opts.backend !== "local" && opts.backend !== "huggingface") {
          console.error(`Invalid backend: ${opts.backend}. Valid: local, huggingface`);
          process.exit(1);
        }

        config.adapter.backend = opts.backend as "local" | "huggingface";

        if (opts.backend === "local") {
          if (opts.model) config.adapter.local.model = opts.model;
          if (opts.endpoint) config.adapter.local.endpoint = opts.endpoint;
        } else {
          if (opts.model) config.adapter.huggingface.model = opts.model;
          if (opts.hfToken) config.adapter.huggingface.token = opts.hfToken;
        }

        saveConfig(config);
        console.log(`Config updated. Backend: ${config.adapter.backend}`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // status — show config and test adapter health
  cmd
    .command("status")
    .description("Show current configuration and adapter health")
    .action(async () => {
      try {
        const config = loadConfig();
        const { adapter } = config;

        console.log(`Backend:  ${adapter.backend}`);
        if (adapter.backend === "local") {
          console.log(`Model:    ${adapter.local.model}`);
          console.log(`Endpoint: ${adapter.local.endpoint}`);
        } else {
          console.log(`Model:    ${adapter.huggingface.model}`);
          console.log(`Token:    ${adapter.huggingface.token ? "set" : "not set"}`);
        }
        console.log(`Glossary: ${config.glossary.dbPath}`);
        console.log(`Context:  ${config.context.dbPath}`);
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  // path — print config file location
  cmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      console.log(join(homedir(), ".config", "tl", "config.jsonc"));
    });

  return cmd;
}
