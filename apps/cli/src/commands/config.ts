import { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "@translate-local/core/config";
import { runAction } from "../utils/run";

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Manage tl configuration");

  // connect — set adapter backend and credentials
  cmd
    .command("connect")
    .description("Configure adapter backend")
    .option("--model <name>", "Model name")
    .option("--endpoint <url>", "Ollama endpoint URL")
    .action((opts: { model?: string; endpoint?: string }) => runAction(() => {
      const config = loadConfig();

      if (opts.model) config.adapter.local.model = opts.model;
      if (opts.endpoint) config.adapter.local.endpoint = opts.endpoint;

      saveConfig(config);
      console.log(`Config updated. Backend: local`);
    }));

  // status — show config and test adapter health
  cmd
    .command("status")
    .description("Show current configuration and adapter health")
    .action(() => runAction(() => {
      const config = loadConfig();
      const { adapter } = config;

      console.log(`Backend:  local`);
      console.log(`Model:    ${adapter.local.model}`);
      console.log(`Endpoint: ${adapter.local.endpoint}`);
      console.log(`Glossary: ${config.glossary.dbPath}`);
      console.log(`Context:  ${config.context.dbPath}`);
    }));

  // path — print config file location
  cmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      console.log(getConfigPath());
    });

  return cmd;
}
