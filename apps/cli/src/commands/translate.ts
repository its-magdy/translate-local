import { Command } from "commander";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { runPipeline } from "@tl/core/pipeline";
import { createAdapter } from "@tl/adapters/factory";
import { TlError } from "@tl/shared/errors";
import type { AdapterConfig } from "@tl/shared/types";
import { formatTranslationResult, formatError } from "../formatters/output";

function coreBackendToAdapterBackend(backend: "local" | "huggingface"): "ollama" | "huggingface" {
  return backend === "local" ? "ollama" : "huggingface";
}

export function makeTranslateCommand(): Command {
  const cmd = new Command();

  cmd
    .name("translate")
    .description("Translate text")
    .argument("<text>", "Text to translate")
    .option("--from <lang>", "Source language (BCP-47 or auto)")
    .option("--to <lang>", "Target language (BCP-47)")
    .option("--glossary <mode>", "Glossary mode: prefer | strict", "prefer")
    .option("--json", "Output JSON")
    .action(async (text: string, opts: { from?: string; to?: string; glossary: string; json?: boolean }) => {
      try {
        const config = loadConfig();
        const sourceLang = opts.from ?? config.defaults.sourceLang;
        const targetLang = opts.to ?? config.defaults.targetLang;
        const glossaryMode = opts.glossary as "prefer" | "strict";

        const adapterCfg: AdapterConfig = {
          backend: coreBackendToAdapterBackend(config.adapter.backend),
          model: config.adapter.backend === "local"
            ? config.adapter.local.model
            : config.adapter.huggingface.model,
          ollamaUrl: config.adapter.local.endpoint,
          hfToken: config.adapter.huggingface.token,
        };

        const adapter = createAdapter(adapterCfg);
        const store = new GlossaryStore(config.glossary.dbPath);

        try {
          const result = await runPipeline(text, sourceLang, targetLang, adapter, store, {
            glossaryMode,
            maxRetries: config.glossary.maxRetries,
          });
          console.log(formatTranslationResult(result, opts.json ?? false));
        } finally {
          store.close();
          await adapter.dispose();
        }
      } catch (err) {
        console.error(formatError(err));
        process.exit(1);
      }
    });

  return cmd;
}
