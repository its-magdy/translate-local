import { Command, Option } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "@translate-local/core/config";
import { GlossaryStore } from "@translate-local/core/glossary";
import { ContextStore } from "@translate-local/core/context";
import { runPipeline } from "@translate-local/core/pipeline";
import { translateFile } from "@translate-local/core/files";
import { createAdapter } from "@translate-local/adapters/factory";
import type { AdapterConfig } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { isSupported } from "@translate-local/shared/utils/language";
import { formatTranslationResult, formatError } from "../formatters/output";
import { inferOutputPath } from "../utils/locale-path";

const IMAGE_EXTS = /\.(png|jpg|jpeg|webp|gif|bmp)$/i;
const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;

type FormatOpt = "auto" | "json" | "yaml" | "raw-json" | "raw-yaml";

export function makeTranslateCommand(): Command {
  const cmd = new Command();

  cmd
    .name("translate")
    .description("Translate text, an image, or a JSON/YAML file")
    .argument("[text]", "Text to translate")
    .option("--from <lang>", "Source language (BCP-47 or auto)")
    .option("--to <lang>", "Target language (BCP-47)")
    .option("--image <path>", "Path to an image file to translate")
    .addOption(new Option("--glossary <mode>", "Glossary mode").choices(["prefer", "strict"]).default("prefer"))
    .option("--json", "Output JSON")
    .option("--file <path>", "Path to a JSON or YAML catalog to translate")
    .option("--out <path>", "Output path for file mode (default: locale-token replacement)")
    .option("--force", "File mode: re-translate every leaf (overwrite existing target values)")
    .option("--dry-run", "File mode: list keys that would be translated without writing")
    .addOption(new Option("--format <fmt>", "File mode: format override").choices(["auto", "json", "yaml", "raw-json", "raw-yaml"]).default("auto"))
    .option("--strict", "File mode: abort the run on first validation failure (default: keep going, fall back to source for failed keys)")
    .option("--translate-all", "File mode: bypass URL/email/semver/all-caps skip heuristics")
    .option("--max-size <mb>", "File mode: max source file size in MB", "20")
    .action(async (text: string | undefined, opts: {
      from?: string; to?: string; image?: string; glossary: "prefer" | "strict"; json?: boolean;
      file?: string; out?: string; force?: boolean; dryRun?: boolean;
      format: FormatOpt; strict?: boolean; translateAll?: boolean; maxSize: string;
    }) => {
      try {
        const config = loadConfig();
        const sourceLang = opts.from ?? config.defaults.sourceLang;
        const targetLang = opts.to ?? config.defaults.targetLang;
        const glossaryMode = opts.glossary;

        const inputModes = [text, opts.image, opts.file].filter(Boolean).length;
        if (inputModes === 0) {
          throw new TlError("INVALID_INPUT", "Provide text to translate, or use --image <path>, or --file <path>.", "Run `tl translate --help` for usage.");
        }
        if (inputModes > 1) {
          throw new TlError("INVALID_INPUT", "Use only one of: positional text, --image, or --file.", "Pick one input mode per invocation.");
        }

        if (sourceLang !== "auto" && !isSupported(sourceLang)) {
          throw new TlError("INVALID_LANGUAGE", `Unsupported source language: "${sourceLang}"`, "Use a BCP-47 code like en, ar, fr.");
        }
        if (!isSupported(targetLang)) {
          throw new TlError("INVALID_LANGUAGE", `Unsupported target language: "${targetLang}"`, "Use a BCP-47 code like en, ar, fr.");
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
          if (opts.file) {
            const sourcePath = resolve(opts.file);
            if (!existsSync(sourcePath)) {
              throw new TlError("FILE_NOT_FOUND", `Source file not found: ${sourcePath}`, "Check the file path and try again.");
            }

            let outPath: string;
            if (opts.out) {
              outPath = resolve(opts.out);
            } else {
              const inferred = inferOutputPath(sourcePath, sourceLang, targetLang);
              if (!inferred) {
                throw new TlError(
                  "INVALID_INPUT",
                  `Cannot infer output path from "${opts.file}"`,
                  "Pass --out <path>, or rename the source so it contains the source locale (e.g. en.json, messages.en.yaml, locales/en/common.json).",
                );
              }
              outPath = inferred;
            }

            const maxBytes = parseFloat(opts.maxSize) * 1024 * 1024;
            if (Number.isNaN(maxBytes) || maxBytes <= 0) {
              throw new TlError("INVALID_INPUT", `Invalid --max-size: "${opts.maxSize}"`, "Use a positive number of MB, e.g. --max-size 10");
            }

            let lastReportedDone = -1;
            const result = await translateFile({
              sourcePath,
              outPath,
              sourceLang,
              targetLang,
              adapter,
              glossary: glossaryStore,
              context: contextStore,
              format: opts.format,
              mode: opts.force ? "force" : "missing-only",
              glossaryMode,
              continueOnError: !opts.strict,
              translateAll: opts.translateAll ?? false,
              maxFileBytes: maxBytes,
              dryRun: opts.dryRun ?? false,
              onProgress: opts.json || opts.dryRun ? undefined : (e) => {
                if (e.done !== lastReportedDone) {
                  lastReportedDone = e.done;
                  process.stderr.write(`\rTranslated ${e.done}/${e.total}`);
                }
              },
            });
            if (!opts.json && !opts.dryRun) process.stderr.write("\n");

            if (opts.json) {
              console.log(JSON.stringify(result, null, 2));
            } else if (opts.dryRun) {
              console.log(`[dry-run] Source: ${sourcePath}`);
              console.log(`[dry-run] Target: ${outPath} (NOT written)`);
              console.log(`[dry-run] Format: ${result.contentFormat}`);
              console.log(`[dry-run] Would translate: ${result.translated}`);
              if (result.skipped.count > 0) {
                console.log(`[dry-run] Would skip: ${result.skipped.count}`);
              }
              for (const w of result.warnings) console.error(`Warning: ${w}`);
            } else {
              console.log(`Wrote ${result.outPath}`);
              console.log(`Format: ${result.contentFormat}`);
              console.log(`Translated: ${result.translated} / ${result.totalLeaves}`);
              if (result.skipped.count > 0) {
                const reasons = Object.entries(result.skipped.reasons).map(([r, n]) => `${r}=${n}`).join(", ");
                console.log(`Skipped: ${result.skipped.count} (${reasons})`);
              }
              if (result.failed.length > 0) {
                console.log(`Failed: ${result.failed.length} (source value used as fallback — search the output for un-translated source text)`);
                for (const f of result.failed) console.error(`  ${f.path}: ${f.reason}`);
              }
              for (const w of result.warnings) console.error(`Warning: ${w}`);
            }
            // Non-zero exit if any keys failed, even in non-strict mode — so CI catches it.
            if (!opts.dryRun && result.failed.length > 0) process.exit(2);
            return;
          }

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
            // Streaming already wrote the translation; reuse the formatter for metadata only.
            const meta = formatTranslationResult({ ...result, translated: "" }, false).trimStart();
            process.stdout.write(`\n${meta}\n`);
          }
        } finally {
          glossaryStore.close();
          contextStore.close();
          await adapter.dispose();
        }
      } catch (err) {
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
