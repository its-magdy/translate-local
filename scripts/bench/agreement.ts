#!/usr/bin/env bun
/**
 * Benchmark: do the words around a glossary term agree with it (elision,
 * contraction, gender, case, no quotes), not just is the term present?
 * Runs against the real TranslateGemma model via Ollama.
 *
 *   bun run scripts/bench/agreement.ts [--runs N] [--mode prefer|strict] [--only <caseId,...>] [--label name]
 *
 * A run is "term ok" when every target term is in the final output, and
 * "agree ok" when, in addition, the case's `expect` regex matches and its
 * `reject` regex (if any) does not. A strict-mode GLOSSARY_STRICT_MISS counts
 * as neither.
 *
 * Uses the core/adapters sources directly with a temp SQLite glossary under a
 * mkdtemp dir (never ~/.config/tl). Model settings are the app defaults.
 * Results (every output, plus the raw output of each attempt) are written to
 * scripts/bench/results/<label>-<timestamp>.json (label defaults to "agreement").
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter, TranslationRequest, TranslationResult } from "../../packages/shared/src/types";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "../../packages/shared/src/constants";
import { computeGlossaryCoverage } from "../../packages/shared/src/utils/text";
import { TranslateGemmaLocalAdapter } from "../../packages/adapters/src/translate-gemma/local";
import { GlossaryStore } from "../../packages/core/src/glossary";
import { runPipeline } from "../../packages/core/src/pipeline";

// ---------- args ----------
const argv = process.argv.slice(2);
const argVal = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Number(argVal("--runs") ?? 3);
const ONLY = argVal("--only")?.split(",");
const LABEL = argVal("--label") ?? "agreement";
const MODE = argVal("--mode") ?? "prefer";
if (MODE !== "strict" && MODE !== "prefer") throw new Error(`--mode must be strict or prefer, got ${MODE}`);
// Same default as config.ts `glossary.maxRetries`.
const MAX_RETRIES = 2;

// ---------- glossary (one per language pair, shared by every case) ----------
const GLOSSARY: Record<string, [string, string][]> = {
  "en-fr": [["server", "hôte"], ["cache", "antémémoire"], ["commit", "validation"]],
  "en-de": [["branch", "Zweig"], ["cache", "Zwischenspeicher"]],
  "en-it": [["server", "host"]],
};

const AP = "['’]";
const FR_REJECT = /\b(le|au|du) hôte|«/i;
type Case = { id: string; tgt: string; text: string; expect: RegExp; reject?: RegExp };
const CASES: Case[] = [
  { id: "A1-fr-restart", tgt: "fr", text: "Restart the server.", expect: new RegExp(`\\bl${AP}hôte`, "i"), reject: FR_REJECT },
  { id: "A2-fr-login", tgt: "fr", text: "Log in to the server.", expect: new RegExp(`(?<!\\p{L})(à|sur) l${AP}hôte`, "iu"), reject: FR_REJECT },
  { id: "A3-fr-down", tgt: "fr", text: "The server is down.", expect: new RegExp(`^l${AP}hôte`, "i"), reject: FR_REJECT },
  { id: "A4-fr-from", tgt: "fr", text: "Copy the files from the server.", expect: new RegExp(`\\b(de|depuis) l${AP}hôte`, "i"), reject: FR_REJECT },
  { id: "A5-fr-clear", tgt: "fr", text: "Clear the cache.", expect: new RegExp(`\\bl${AP}antémémoire`, "i"), reject: /\b(le|la|au|du) antémémoire|«/i },
  { id: "A6-fr-full", tgt: "fr", text: "The cache is full.", expect: new RegExp(`^l${AP}antémémoire est pleine`, "i") },
  { id: "A7-fr-signed", tgt: "fr", text: "Every commit must be signed.", expect: /validation doit être signée/i },
  { id: "A8-de-new", tgt: "de", text: "Create a new branch for this feature.", expect: /\beinen neuen Zweig/i },
  { id: "A9-de-old", tgt: "de", text: "Delete the old branch.", expect: /\bden alten Zweig/i },
  { id: "A10-de-full", tgt: "de", text: "The cache is full.", expect: /^der Zwischenspeicher ist voll/i },
  { id: "A11-it-restart", tgt: "it", text: "Restart the server.", expect: new RegExp(`\\bl${AP}host`, "i"), reject: /\b(il|lo) host/i },
];

// ---------- instrumented adapter ----------
class CountingAdapter implements Adapter {
  raws: string[] = [];
  constructor(private readonly inner: Adapter) {}
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const res = await this.inner.translate(request);
    this.raws.push(res.translated);
    return res;
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

async function main(): Promise<void> {
  const tags = await fetch(`${DEFAULT_OLLAMA_URL}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags) throw new Error(`Ollama not reachable at ${DEFAULT_OLLAMA_URL}`);

  const dir = mkdtempSync(join(tmpdir(), "tl-agree-"));
  const glossary = new GlossaryStore(join(dir, "glossary.db"));
  for (const [pair, entries] of Object.entries(GLOSSARY)) {
    const [sourceLang, targetLang] = pair.split("-");
    glossary.addMany(entries.map(([sourceTerm, targetTerm]) => ({ sourceTerm, targetTerm, sourceLang, targetLang })));
  }
  const rec = new CountingAdapter(new TranslateGemmaLocalAdapter(DEFAULT_MODEL, DEFAULT_OLLAMA_URL));
  const cases = ONLY ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;
  const rows: Record<string, unknown>[] = [];
  const all: Record<string, unknown[]> = {};
  let tTerm = 0, tAgree = 0, tCalls = 0, tMs = 0, tN = 0;
  console.log(`tmp dir: ${dir}\nmodel: ${DEFAULT_MODEL}  mode: ${MODE}  runs: ${RUNS}  cases: ${cases.length}\n`);

  try {
    for (const c of cases) {
      let term = 0, agree = 0, calls = 0, ms = 0;
      const outs: unknown[] = [];
      for (let i = 0; i < RUNS; i++) {
        rec.raws = [];
        const t0 = performance.now();
        let out = "";
        let failed = false;
        try {
          out = (await runPipeline(c.text, "en", c.tgt, rec, glossary, { glossaryMode: MODE, maxRetries: MAX_RETRIES })).translated;
        } catch (err) {
          failed = true;
          out = `ERROR ${err instanceof Error ? err.message : String(err)}`;
        }
        const dt = performance.now() - t0;
        const hits = glossary.findMatches(c.text, "en", c.tgt);
        const termOk = !failed && computeGlossaryCoverage(hits, out).missingTerms.length === 0;
        const agreeOk = termOk && c.expect.test(out.trim()) && !(c.reject?.test(out) ?? false);
        term += +termOk; agree += +agreeOk; calls += rec.raws.length; ms += dt;
        outs.push({ out, termOk, agreeOk, calls: rec.raws.length, raws: rec.raws });
        console.log(`${c.id} ${i + 1}/${RUNS}: term=${termOk ? "ok" : "MISS"} agree=${agreeOk ? "ok" : "BAD"} calls=${rec.raws.length} ${Math.round(dt)}ms  ${JSON.stringify(out)}`);
      }
      tTerm += term; tAgree += agree; tCalls += calls; tMs += ms; tN += RUNS;
      all[c.id] = outs;
      rows.push({ id: c.id, term: `${term}/${RUNS}`, agree: `${agree}/${RUNS}`, meanCalls: +(calls / RUNS).toFixed(2), meanMs: Math.round(ms / RUNS) });
    }
  } finally {
    await rec.dispose();
    glossary.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log();
  console.table(rows);
  const total = `term ${tTerm}/${tN}  agree ${tAgree}/${tN}  meanCalls ${(tCalls / tN).toFixed(2)}  meanMs ${Math.round(tMs / tN)}`;
  console.log(`\nTOTAL ${total}`);

  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ model: DEFAULT_MODEL, mode: MODE, runs: RUNS, maxRetries: MAX_RETRIES, glossary: GLOSSARY, total, rows, all }, null, 2));
  console.log(`Results: ${outFile}`);
}

await main();
