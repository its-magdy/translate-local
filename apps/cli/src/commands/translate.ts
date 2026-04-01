import { Command } from "commander";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { ContextStore } from "@tl/core/context";
import { runPipeline } from "@tl/core/pipeline";
import { createAdapter } from "@tl/adapters/factory";
import type { AdapterConfig } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";
import { isSupported } from "@tl/shared/utils/language";
import { formatTranslationResult, formatError } from "../formatters/output";
import { resolve } from "path";

export function makeTranslateCommand(): Command {
  const cmd = new Command();

  cmd
    .name("translate")
    .description("Translate text or an image")
    .argument("[text]", "Text to translate")
    .option("--from <lang>", "Source language (BCP-47 or auto)")
    .option("--to <lang>", "Target language (BCP-47)")
    .option("--image <path>", "Path to an image file to translate")
    .option("--glossary <mode>", "Glossary mode: prefer | strict", "prefer")
    .option("--json", "Output JSON")
    .action(async (text: string | undefined, opts: { from?: string; to?: string; image?: string; glossary: string; json?: boolean }) => {
      try {
        const config = loadConfig();
        const sourceLang = opts.from ?? config.defaults.sourceLang;
        const targetLang = opts.to ?? config.defaults.targetLang;
        const glossaryMode = opts.glossary as "prefer" | "strict";

        if (glossaryMode !== "prefer" && glossaryMode !== "strict") {
          const msg = `Invalid glossary mode: "${opts.glossary}". Use "prefer" or "strict".`;
          if (opts.json) { console.error(JSON.stringify({ error: "INVALID_INPUT", message: msg })); }
          else { console.error(msg); }
          process.exit(1);
        }

        if (!text && !opts.image) {
          const msg = "Provide text to translate or use --image <path>.";
          if (opts.json) { console.error(JSON.stringify({ error: "INVALID_INPUT", message: msg })); }
          else { console.error(msg); }
          process.exit(1);
        }

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

        const adapterBackend = (process.env.TL_ADAPTER === "mock" ? "mock" : "ollama") as AdapterConfig["backend"];
        const adapterCfg: AdapterConfig = {
          backend: adapterBackend,
          model: config.adapter.local.model,
          ollamaUrl: config.adapter.local.endpoint,
        };

        const adapter = createAdapter(adapterCfg);
        const glossaryStore = new GlossaryStore(config.glossary.dbPath);
        const contextStore = new ContextStore(config.context.dbPath);

        try {
          const IMAGE_EXTS = /\.(png|jpg|jpeg|webp|gif|bmp)$/i;
          const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

          let imageBase64: string | undefined;
          if (opts.image) {
            opts.image = resolve(opts.image);
            if (!IMAGE_EXTS.test(opts.image)) {
              throw new TlError("IMAGE_INVALID_TYPE", `Unsupported image type: ${opts.image}`, "Use a .png, .jpg, .jpeg, .webp, .gif, or .bmp file.");
            }
            const file = Bun.file(opts.image);
            if (!(await file.exists())) {
              throw new TlError("IMAGE_NOT_FOUND", `Image not found: ${opts.image}`, "Check the file path and try again.");
            }
            if (file.size > IMAGE_SIZE_LIMIT) {
              throw new TlError("IMAGE_TOO_LARGE", `Image exceeds 10 MB: ${opts.image}`, "Use a smaller image file.");
            }
            try {
              const buf = await file.arrayBuffer();
              imageBase64 = Buffer.from(buf).toString("base64");
            } catch (err) {
              throw new TlError("IMAGE_READ_FAILED", `Failed to read image: ${opts.image}`, "Ensure the file is readable.", err);
            }
          }

          // BUG-008: retrieve context snippets before running the pipeline
          const queryText = text ?? "";
          const snippets = queryText ? contextStore.retrieve(queryText, config.context.maxSnippets) : [];
          const contextSnippets = snippets
            .filter((s) => s.score >= config.context.minRelevance)
            .map((s) => s.content);

          const isJson = opts.json ?? false;
          const result = await runPipeline(queryText, sourceLang, targetLang, adapter, glossaryStore, {
            glossaryMode,
            maxRetries: config.glossary.maxRetries,
            contextSnippets,
            imageBase64,
            onChunk: isJson ? undefined : (chunk) => process.stdout.write(chunk),
          });
          if (isJson) {
            console.log(formatTranslationResult(result, true));
          } else {
            // Streaming already wrote the translation tokens; reuse formatter for
            // metadata lines by zeroing out the translated text so nothing is reprinted.
            const meta = formatTranslationResult({ ...result, translated: "" }, false).trimStart();
            process.stdout.write(`\n${meta}\n`);
          }
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
