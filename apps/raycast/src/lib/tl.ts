import { execFile } from "child_process";
import { promisify } from "util";
import { getPreferenceValues } from "@raycast/api";
import type { TlTranslateResult, TlGlossaryEntry, TlError, TranslateOptions, GlossaryAddOptions } from "./types";

const exec = promisify(execFile);

function getTlPath(): string {
  const { tlPath } = getPreferenceValues<{ tlPath: string }>();
  return tlPath || "tl";
}

export class TlCommandError extends Error {
  constructor(
    public readonly tag: string,
    public readonly hint?: string
  ) {
    super(`[${tag}] ${hint ?? "Unknown error"}`);
    this.name = "TlCommandError";
  }
}

async function runTl(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(getTlPath(), args, { timeout: 30_000 });
    return stdout;
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    if (err.stderr) {
      try {
        const tlError: TlError = JSON.parse(err.stderr);
        throw new TlCommandError(tlError.tag, tlError.hint);
      } catch (parseErr) {
        if (parseErr instanceof TlCommandError) throw parseErr;
      }
    }
    throw new TlCommandError("CLI_ERROR", err.message ?? "Failed to run tl");
  }
}

export function buildTranslateArgs(opts: TranslateOptions): string[] {
  const args = ["translate", opts.text, "--to", opts.to, "--json"];
  if (opts.from) args.push("--from", opts.from);
  if (opts.glossaryMode) args.push("--glossary", opts.glossaryMode);
  if (opts.imagePath) args.push("--image", opts.imagePath);
  return args;
}

export async function translate(opts: TranslateOptions): Promise<TlTranslateResult> {
  const stdout = await runTl(buildTranslateArgs(opts));
  return JSON.parse(stdout);
}

export async function listGlossary(opts?: { from?: string; to?: string; domain?: string }): Promise<TlGlossaryEntry[]> {
  const args = ["glossary", "list", "--json"];
  if (opts?.from) args.push("--from", opts.from);
  if (opts?.to) args.push("--to", opts.to);
  if (opts?.domain) args.push("--domain", opts.domain);
  const stdout = await runTl(args);
  return JSON.parse(stdout);
}

export async function addGlossaryEntry(opts: GlossaryAddOptions): Promise<void> {
  const args = ["glossary", "add", "--source", opts.source, "--target", opts.target, "--from", opts.from, "--to", opts.to];
  if (opts.domain) args.push("--domain", opts.domain);
  if (opts.note) args.push("--note", opts.note);
  await runTl(args);
}

export async function removeGlossaryEntry(id: string): Promise<void> {
  await runTl(["glossary", "remove", id]);
}

export async function exportGlossary(): Promise<string> {
  return await runTl(["glossary", "export", "--json"]);
}
