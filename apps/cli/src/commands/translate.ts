import { Command, Option } from "commander";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "@translate-local/core/config";
import { TranslationSession, readImageBase64 } from "@translate-local/core/session";
import { translateFile } from "@translate-local/core/files";
import { TlError } from "@translate-local/shared/errors";
import { isSupported } from "@translate-local/shared/utils/language";
import { formatTranslationResult } from "../formatters/output";
import { inferOutputPath, inferSourceLocale } from "../utils/locale-path";
import { runAction } from "../utils/run";

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
    .option("--prune", "File mode: remove target keys that no longer exist in the source")
    .option("--allow-large-prune", "File mode: let --prune remove more than half of the target (or all of it)")
    .addOption(new Option("--format <fmt>", "File mode: format override").choices(["auto", "json", "yaml", "raw-json", "raw-yaml"]).default("auto"))
    .option("--strict", "File mode: abort the run on first validation failure (default: keep going, fall back to source for failed keys)")
    .option("--translate-all", "File mode: bypass URL/email/semver/all-caps skip heuristics")
    .option("--max-size <mb>", "File mode: max source file size in MB", "20")
    .action((text: string | undefined, opts: {
      from?: string; to?: string; image?: string; glossary: "prefer" | "strict"; json?: boolean;
      file?: string; out?: string; force?: boolean; dryRun?: boolean; prune?: boolean; allowLargePrune?: boolean;
      format: FormatOpt; strict?: boolean; translateAll?: boolean; maxSize: string;
    }) => runAction(async () => {
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

      const imageBase64 = opts.image ? await readImageBase64(resolve(opts.image)) : undefined;

      const session = new TranslationSession(config);
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

          // `\r` progress only makes sense on a terminal; in CI/piped logs it
          // would concatenate into one line, so stay silent there.
          const showProgress = !opts.json && !opts.dryRun && !!process.stderr.isTTY;
          let lastReportedDone = -1;
          const result = await translateFile({
            sourcePath,
            outPath,
            sourceLang,
            // Lets core recognise a Rails `en:` root when --from is auto.
            sourceLocale: sourceLang === "auto" ? inferSourceLocale(sourcePath, sourceLang) ?? undefined : sourceLang,
            targetLang,
            adapter: session.adapter,
            glossary: session.glossaryStore,
            context: session.contextStore,
            format: opts.format,
            mode: opts.force ? "force" : "missing-only",
            glossaryMode,
            continueOnError: !opts.strict,
            translateAll: opts.translateAll ?? false,
            maxFileBytes: maxBytes,
            dryRun: opts.dryRun ?? false,
            maxSnippets: config.context.maxSnippets,
            minRelevance: config.context.minRelevance,
            prune: opts.prune ?? false,
            allowLargePrune: opts.allowLargePrune ?? false,
            onProgress: showProgress ? (e) => {
              if (e.done !== lastReportedDone) {
                lastReportedDone = e.done;
                process.stderr.write(`\rTranslated ${e.done}/${e.total}`);
              }
            } : undefined,
          });
          if (showProgress) process.stderr.write("\n");

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (opts.dryRun) {
            console.log(`[dry-run] Source: ${sourcePath}`);
            console.log(`[dry-run] Target: ${outPath} (NOT written)`);
            console.log(`[dry-run] Format: ${result.contentFormat}`);
            if (result.rootLocaleKey) {
              console.log(`[dry-run] Root locale key: ${result.rootLocaleKey.from} -> ${result.rootLocaleKey.to}`);
            }
            console.log(`[dry-run] Would translate: ${result.translated}`);
            if (result.skipped.count > 0) {
              console.log(`[dry-run] Would skip: ${result.skipped.count}`);
            }
            if (result.changed.length > 0) {
              console.log(`[dry-run] Source changed: ${result.changed.length}`);
              for (const p of result.changed) console.log(`  ${p}`);
            }
            if (opts.prune) {
              console.log(`[dry-run] Would prune: ${result.pruned.length}`);
              for (const p of result.pruned) console.log(`  ${p}`);
            }
            for (const w of result.warnings) console.error(`Warning: ${w}`);
          } else {
            console.log(`Wrote ${result.outPath}`);
            console.log(`Format: ${result.contentFormat}`);
            if (result.rootLocaleKey) {
              console.log(`Root locale key: ${result.rootLocaleKey.from} -> ${result.rootLocaleKey.to}`);
            }
            console.log(`Translated: ${result.translated} / ${result.totalLeaves}`);
            if (result.changed.length > 0) console.log(`Source changed: ${result.changed.length}`);
            if (opts.prune) console.log(`Pruned: ${result.pruned.length}`);
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
          if (!opts.dryRun && result.failed.length > 0) process.exitCode = 2;
        } else {
          const isJson = opts.json ?? false;
          // Stream only to an interactive terminal. Piped stdout must carry
          // exactly the final translation once: streamed chunks are raw
          // pre-postprocess tokens (glossary tags, unnormalized whitespace),
          // and strict-mode retries would concatenate two attempts.
          // TL_FORCE_TTY overrides detection so tests can exercise this path
          // without a real pty.
          const isTty = process.env.TL_FORCE_TTY !== undefined
            ? process.env.TL_FORCE_TTY === "1"
            : process.stdout.isTTY === true;
          const streamLive = !isJson && isTty;
          let streamedText = "";
          const result = await session.translate(text ?? "", sourceLang, targetLang, {
            glossaryMode,
            imageBase64,
            onChunk: streamLive ? (chunk) => { streamedText += chunk; process.stdout.write(chunk); } : undefined,
          });
          if (isJson) {
            console.log(formatTranslationResult(result, true));
          } else {
            if (!streamedText) {
              // Nothing streamed (piped stdout, or a non-streaming adapter).
              process.stdout.write(`${result.translated}\n`);
            } else if (streamedText.trim() !== result.translated) {
              // Streamed tokens were raw first-attempt output; postprocessing
              // or retries changed the final text, so print the real one.
              process.stdout.write(`\n${result.translated}\n`);
            } else {
              process.stdout.write("\n");
            }
            // Same lookup the pipeline did (images skip the glossary): coverage
            // is only worth a line when some term actually matched.
            const glossaryMatched = !imageBase64 && session.glossaryStore.findMatches(text ?? "", sourceLang, targetLang).length > 0;
            // Metadata on stderr so stdout carries only the translation (pipe-safe).
            const meta = formatTranslationResult(result, false, process.stderr, { includeTranslation: false, glossaryMatched });
            process.stderr.write(`${meta}\n`);
          }
        }
      } finally {
        // Closes the stores; unloads the model only if a request was sent
        // (a dry run never loads it).
        await session.dispose();
      }
    }, { json: opts.json }));

  return cmd;
}
