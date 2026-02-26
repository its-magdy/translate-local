import { Command } from "commander";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { ContextStore } from "@tl/core/context";
import { runPipeline } from "@tl/core/pipeline";
import { createAdapter } from "@tl/adapters/factory";
import type { AdapterConfig } from "@tl/shared/types";
import { isSupported } from "@tl/shared/utils/language";
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

        // BUG-004: validate language codes
        if (sourceLang !== "auto" && !isSupported(sourceLang)) {
          const msg = `Unsupported source language: "${sourceLang}"`;
          if (opts.json) { console.error(JSON.stringify({ error: "INVALID_LANG", message: msg })); }
          else { console.error(msg); }
          process.exit(1);
        }
        if (!isSupported(targetLang)) {
          const msg = `Unsupported target language: "${targetLang}"`;
          if (opts.json) { console.error(JSON.stringify({ error: "INVALID_LANG", message: msg })); }
          else { console.error(msg); }
          process.exit(1);
        }

        const adapterCfg: AdapterConfig = {
          backend: coreBackendToAdapterBackend(config.adapter.backend),
          model: config.adapter.backend === "local"
            ? config.adapter.local.model
            : config.adapter.huggingface.model,
          ollamaUrl: config.adapter.local.endpoint,
          hfToken: config.adapter.huggingface.token,
        };

        const adapter = createAdapter(adapterCfg);
        const glossaryStore = new GlossaryStore(config.glossary.dbPath);
        const contextStore = new ContextStore(config.context.dbPath);

        try {
          // BUG-008: retrieve context snippets before running the pipeline
          const snippets = contextStore.retrieve(text, config.context.maxSnippets);
          const contextSnippets = snippets
            .filter((s) => s.score >= config.context.minRelevance)
            .map((s) => s.content);

          const result = await runPipeline(text, sourceLang, targetLang, adapter, glossaryStore, {
            glossaryMode,
            maxRetries: config.glossary.maxRetries,
            contextSnippets,
          });
          console.log(formatTranslationResult(result, opts.json ?? false));
        } finally {
          glossaryStore.close();
          contextStore.close();
          await adapter.dispose();
        }
      } catch (err) {
        // BUG-005: emit JSON error when --json flag is set
        if (opts.json) {
          const e = err as any;
          console.error(JSON.stringify({ error: e?.tag ?? "TRANSLATION_FAILED", message: e?.message ?? String(err), hint: e?.hint }));
        } else {
          console.error(formatError(err));
        }
        process.exit(1);
      }
    });

  return cmd;
}
