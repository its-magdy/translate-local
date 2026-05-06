import { Command } from "commander";
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
import { resolve } from "path";

export function makeTranslateCommand(): Command {
  const cmd = new Command();

  cmd
    .name("translate")
    .description("Translate text, an image, or a JSON/YAML file")
    .argument("[text]", "Text to translate")
    .option("--from <lang>", "Source language (BCP-47 or auto)")
    .option("--to <lang>", "Target language (BCP-47)")
    .option("--image <path>", "Path to an image file to translate")
    .option("--glossary <mode>", "Glossary mode: prefer | strict", "prefer")
    .option("--json", "Output JSON")
    // File mode (with --file). All flags below apply only when --file is set.
    .option("--file <path>", "Path to a JSON or YAML catalog to translate")
    .option("--out <path>", "Output path for file mode (default: locale-token replacement)")
    .option("--force", "File mode: re-translate every leaf (overwrite existing target values)")
    .option("--dry-run", "File mode: list keys that would be translated without writing")
    .option("--format <fmt>", "File mode: format override — auto | json | yaml | raw-json | raw-yaml", "auto")
    .option("--strict", "File mode: abort the run on first validation failure (default: keep going, fall back to source for failed keys)")
    .option("--translate-all", "File mode: bypass URL/email/semver/all-caps skip heuristics")
    .option("--max-size <mb>", "File mode: max source file size in MB", "20")
    .action(async (text: string | undefined, opts: {
      from?: string; to?: string; image?: string; glossary: string; json?: boolean;
      file?: string; out?: string; force?: boolean; dryRun?: boolean;
      format: string; strict?: boolean; translateAll?: boolean; maxSize: string;
    }) => {
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

        // Mutually exclusive input modes
        const inputModes = [text, opts.image, opts.file].filter(Boolean).length;
        if (inputModes === 0) {
          const msg = "Provide text to translate, or use --image <path>, or --file <path>.";
          if (opts.json) { console.error(JSON.stringify({ error: "INVALID_INPUT", message: msg })); }
          else { console.error(msg); }
          process.exit(1);
        }
        if (inputModes > 1) {
          const msg = "Use only one of: positional text, --image, or --file.";
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
          // ── File mode ────────────────────────────────────────────────────
          if (opts.file) {
            const sourcePath = resolve(opts.file);
            const formatOverride = (opts.format ?? "auto") as "auto" | "json" | "yaml" | "raw-json" | "raw-yaml";
            const validFormats = ["auto", "json", "yaml", "raw-json", "raw-yaml"];
            if (!validFormats.includes(formatOverride)) {
              throw new TlError("INVALID_INPUT", `Invalid --format: "${opts.format}"`, `Use one of: ${validFormats.join(", ")}`);
            }

            // Check file existence first, before locale-token inference. A typo'd
            // path is a more fundamental error than a missing locale token; users
            // get a clearer message this way.
            const { existsSync: srcExists } = await import("fs");
            if (!srcExists(sourcePath)) {
              throw new TlError("FILE_NOT_FOUND", `Source file not found: ${sourcePath}`, "Check the file path and try again.");
            }

            // Resolve out path: --out wins; otherwise infer from locale tokens
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

            // Dry-run: report what would be translated, write nothing.
            // Implemented via a no-op adapter that records calls without translating.
            if (opts.dryRun) {
              type Probe = { count: number };
              const probe: Probe = { count: 0 };
              const noopAdapter = {
                async translate(req: { source: string; sourceLang: string; targetLang: string }) {
                  probe.count++;
                  return {
                    translated: req.source,
                    sourceLang: req.sourceLang,
                    targetLang: req.targetLang,
                    glossaryCoverage: 1,
                    missingTerms: [],
                    metadata: { adapter: "dry-run", durationMs: 0, retries: 0 },
                  };
                },
                async dispose() {},
              };
              // Run against a temp out path so the real one is never touched
              const { mkdtempSync, rmSync } = await import("fs");
              const { tmpdir } = await import("os");
              const { join: pjoin } = await import("path");
              const tmpDir = mkdtempSync(pjoin(tmpdir(), "tl-dry-"));
              const tmpOut = pjoin(tmpDir, "out" + (sourcePath.endsWith(".yaml") || sourcePath.endsWith(".yml") ? ".yaml" : ".json"));
              try {
                const dryResult = await translateFile({
                  sourcePath,
                  outPath: tmpOut,
                  sourceLang,
                  targetLang,
                  adapter: noopAdapter,
                  glossary: glossaryStore,
                  context: contextStore,
                  format: formatOverride,
                  mode: opts.force ? "force" : "missing-only",
                  glossaryMode,
                  continueOnError: true,
                  translateAll: opts.translateAll ?? false,
                  maxFileBytes: maxBytes,
                });
                const dryReport = {
                  source: sourcePath,
                  target: outPath,
                  contentFormat: dryResult.contentFormat,
                  pending: dryResult.totalLeaves,
                  wouldTranslate: dryResult.translated,
                  wouldSkip: dryResult.skipped,
                  warnings: dryResult.warnings,
                };
                if (opts.json) {
                  console.log(JSON.stringify(dryReport, null, 2));
                } else {
                  console.log(`[dry-run] Source: ${dryReport.source}`);
                  console.log(`[dry-run] Target: ${dryReport.target} (NOT written)`);
                  console.log(`[dry-run] Format: ${dryReport.contentFormat}`);
                  console.log(`[dry-run] Would translate: ${dryReport.wouldTranslate}`);
                  if (dryReport.wouldSkip.count > 0) {
                    console.log(`[dry-run] Would skip: ${dryReport.wouldSkip.count}`);
                  }
                  for (const w of dryReport.warnings) console.error(`Warning: ${w}`);
                }
              } finally {
                rmSync(tmpDir, { recursive: true, force: true });
              }
              return;
            }

            // Real run
            let lastReportedDone = -1;
            const result = await translateFile({
              sourcePath,
              outPath,
              sourceLang,
              targetLang,
              adapter,
              glossary: glossaryStore,
              context: contextStore,
              format: formatOverride,
              mode: opts.force ? "force" : "missing-only",
              glossaryMode,
              continueOnError: !opts.strict,
              translateAll: opts.translateAll ?? false,
              maxFileBytes: maxBytes,
              onProgress: opts.json ? undefined : (e) => {
                // throttle progress to avoid 1000-line stderr churn
                if (e.done !== lastReportedDone) {
                  lastReportedDone = e.done;
                  process.stderr.write(`\rTranslated ${e.done}/${e.total}`);
                }
              },
            });
            if (!opts.json) process.stderr.write("\n");

            if (opts.json) {
              console.log(JSON.stringify(result, null, 2));
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
            // Non-zero exit if any keys failed, even in non-strict mode — so CI catches it
            if (result.failed.length > 0) process.exit(2);
            return;
          }
          // ── End file mode ────────────────────────────────────────────────

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
