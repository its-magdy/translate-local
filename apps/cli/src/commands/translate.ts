import { Command, Option } from "commander";
import { resolve } from "path";
import { loadConfig } from "@translate-local/core/config";
import { TranslationSession, readImageBase64 } from "@translate-local/core/session";
import { translateFile } from "@translate-local/core/files";
import { TlError } from "@translate-local/shared/errors";
import { isSupported } from "@translate-local/shared/utils/language";
import { formatFileSummary, formatTranslationResult } from "../formatters/output";
import { exitOnInterrupt, runAction } from "../utils/run";

type FormatOpt = "auto" | "json" | "yaml" | "raw-json" | "raw-yaml";

// Through process.stdin, not Bun.stdin.text(): on Windows the latter never
// settled for a pipe, so the process exited 0 without output.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function makeTranslateCommand(): Command {
  const cmd = new Command();

  cmd
    .name("translate")
    .description("Translate text, an image, or a JSON/YAML file")
    .argument("[text]", "Text to translate (default: piped stdin)")
    .option("--from <lang>", "Source language (BCP-47 or auto)")
    .option("--to <lang>", "Target language (BCP-47)")
    .option("--image <path>", "Path to an image file to translate")
    .addOption(new Option("--glossary <mode>", "Glossary mode (default: glossary.mode from config, else prefer)").choices(["prefer", "strict"]))
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
      from?: string; to?: string; image?: string; glossary?: "prefer" | "strict"; json?: boolean;
      file?: string; out?: string; force?: boolean; dryRun?: boolean; prune?: boolean; allowLargePrune?: boolean;
      format: FormatOpt; strict?: boolean; translateAll?: boolean; maxSize: string;
    }) => runAction(async () => {
      const config = loadConfig();
      const sourceLang = opts.from ?? config.defaults.sourceLang;
      const targetLang = opts.to ?? config.defaults.targetLang;
      const glossaryMode = opts.glossary ?? config.glossary.mode;

      // Piped input is the text when none is given: `echo hi | tl --to fr`.
      // Trailing line breaks (echo's newline) are dropped; inner ones are kept.
      if (!text && !opts.image && !opts.file && !process.stdin.isTTY) {
        const piped = (await readStdin()).replace(/(\r?\n)+$/, "");
        if (piped.trim()) text = piped;
      }

      const inputModes = [text, opts.image, opts.file].filter(Boolean).length;
      if (inputModes === 0) {
        throw new TlError("INVALID_INPUT", "Provide text to translate (as an argument or on stdin), or use --image <path>, or --file <path>.", "Run `tl translate --help` for usage.");
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
      const stopInterruptHandling = exitOnInterrupt(session);
      try {
        if (opts.file) {
          const sourcePath = resolve(opts.file);
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
            outPath: opts.out ? resolve(opts.out) : undefined,
            sourceLang,
            targetLang,
            translator: session.fileTranslator({ glossaryMode }),
            // Ctrl+C: stop between keys and write the finished ones (exitOnInterrupt sets 130/143).
            signal: session.signal,
            format: opts.format,
            mode: opts.force ? "force" : "missing-only",
            continueOnError: !opts.strict,
            translateAll: opts.translateAll ?? false,
            maxFileBytes: maxBytes,
            dryRun: opts.dryRun ?? false,
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
          } else {
            const { stdout, stderr } = formatFileSummary(result, sourcePath, { dryRun: opts.dryRun ?? false, prune: opts.prune ?? false });
            for (const line of stdout) console.log(line);
            for (const line of stderr) console.error(line);
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
            // Metadata on stderr so stdout carries only the translation (pipe-safe).
            const meta = formatTranslationResult(result, false, process.stderr, { includeTranslation: false });
            process.stderr.write(`${meta}\n`);
          }
        }
      } finally {
        // Closes the stores; unloads the model only if a request was sent
        // (a dry run never loads it).
        await session.dispose();
        stopInterruptHandling();
      }
    }, { json: opts.json }));

  return cmd;
}
