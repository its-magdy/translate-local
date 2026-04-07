import { Command } from "commander";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { ContextStore } from "@tl/core/context";
import { runPipeline } from "@tl/core/pipeline";
import { createAdapter } from "@tl/adapters/factory";
import type { AdapterConfig } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";
import { isSupported } from "@tl/shared/utils/language";
import { isRtlLang } from "@tl/shared/constants";
import { detectTerminalBidiCapability } from "@tl/shared/utils/terminal";
import { reshapeForTerminal } from "@tl/shared/utils/bidi";
import { formatTranslationResult, formatError } from "../formatters/output";
import { resolve } from "path";

type BidiMode = "auto" | "raw" | "reshape";

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
    .option("--bidi <mode>", "RTL render mode: auto | raw | reshape", "auto")
    .action(async (text: string | undefined, opts: { from?: string; to?: string; image?: string; glossary: string; json?: boolean; bidi?: string }) => {
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

        const bidiMode: BidiMode = (opts.bidi ?? "auto") as BidiMode;
        if (bidiMode !== "auto" && bidiMode !== "raw" && bidiMode !== "reshape") {
          const msg = `Invalid bidi mode: "${opts.bidi}". Use "auto", "raw", or "reshape".`;
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

        if (process.env.TL_ADAPTER && process.env.TL_ADAPTER !== "mock" && process.env.TL_ADAPTER !== "ollama") {
          console.warn(`Warning: unknown TL_ADAPTER "${process.env.TL_ADAPTER}", falling back to "ollama"`);
        }
        const adapterBackend = process.env.TL_ADAPTER === "mock" ? "mock" : "ollama";
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
          const isTty = Boolean(process.stdout.isTTY);
          const targetIsRtl = isRtlLang(targetLang);

          // RTL targets must NOT stream per-token to a TTY:
          //   1. Even shaping-capable terminals re-shape the line on every
          //      write, which causes glyph flicker / mid-letter splits when
          //      tokens arrive 1–3 codepoints at a time (Ollama NDJSON).
          //   2. Most popular dev terminals (Ghostty, kitty, Alacritty,
          //      WezTerm default, Windows Terminal, VS Code, tmux) don't
          //      shape Arabic at all and need pre-shaped Presentation Forms
          //      in visual order — which we can only produce on the full
          //      buffered string, not per token.
          // For LTR targets, JSON, or piped output we keep the existing
          // streaming behavior unchanged.
          const bufferForRtl = targetIsRtl && isTty && !isJson;

          const result = await runPipeline(queryText, sourceLang, targetLang, adapter, glossaryStore, {
            glossaryMode,
            maxRetries: config.glossary.maxRetries,
            contextSnippets,
            imageBase64,
            onChunk: isJson || bufferForRtl ? undefined : (chunk) => process.stdout.write(chunk),
          });
          if (isJson) {
            console.log(formatTranslationResult(result, true));
          } else if (bufferForRtl) {
            // Decide whether to emit logical-order UTF-8 (BiDi-capable host)
            // or pre-shaped visual-order Presentation Forms (shaping-blind
            // host). `auto` probes env vars; `raw` and `reshape` force.
            const shouldReshape =
              bidiMode === "reshape" ||
              (bidiMode === "auto" && detectTerminalBidiCapability() === "reshape");
            const out = shouldReshape ? reshapeForTerminal(result.translated) : result.translated;
            process.stdout.write(out);
            const meta = formatTranslationResult({ ...result, translated: "" }, false).trimStart();
            process.stdout.write(`\n${meta}\n`);
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
          const e = err instanceof TlError ? err : null;
          console.error(JSON.stringify({ error: e?.tag ?? "TRANSLATION_FAILED", message: e?.message ?? String(err), hint: e?.hint ?? null }));
        } else {
          console.error(formatError(err));
        }
        process.exit(1);
      }
    });

  return cmd;
}
