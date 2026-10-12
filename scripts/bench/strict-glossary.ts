#!/usr/bin/env bun
/**
 * Benchmark: glossary enforcement + placeholder preservation against
 * the real TranslateGemma model via Ollama.
 *
 *   bun run scripts/bench/strict-glossary.ts [--runs N] [--only <caseId,...>] [--label name] [--mode strict|prefer]
 *
 * --mode (default strict) is the glossary mode every case runs in. Strict mode
 * succeeds when nothing throws; prefer mode never throws for a miss, so there
 * a case succeeds only when the output contains every required target term
 * (and, for P cases, every placeholder).
 *
 * Uses the core/adapters sources directly with temp SQLite dbs under a mkdtemp
 * dir (never ~/.config/tl). Model settings are exactly the app defaults: the
 * adapter sends no options, so Ollama uses the Modelfile's sampling params.
 * Full results (with prompts + raw outputs of every failed case/run) are written
 * to scripts/bench/results/<label>-<timestamp>.json (label defaults to "run").
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter, TranslationRequest, TranslationResult } from "../../packages/shared/src/types";
import { TlError } from "../../packages/shared/src/errors";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "../../packages/shared/src/constants";
import { stripGlossaryTags, normalizeWhitespace, computeGlossaryCoverage } from "../../packages/shared/src/utils/text";
import { TranslateGemmaLocalAdapter } from "../../packages/adapters/src/translate-gemma/local";
import { buildStructuredPrompt } from "../../packages/adapters/src/base";
import { GlossaryStore } from "../../packages/core/src/glossary";
import { ContextStore } from "../../packages/core/src/context";
import { runPipeline } from "../../packages/core/src/pipeline";
import { translateFile } from "../../packages/core/src/files/index";

// ---------- args ----------
const argv = process.argv.slice(2);
const argVal = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Number(argVal("--runs") ?? 3);
const ONLY = argVal("--only")?.split(",");
const LABEL = argVal("--label") ?? "run";
const MODE = argVal("--mode") ?? "strict";
if (MODE !== "strict" && MODE !== "prefer") throw new Error(`--mode must be strict or prefer, got ${MODE}`);
// Same default as config.ts `glossary.maxRetries`.
const MAX_RETRIES = 2;

// ---------- glossary (one per language pair, shared by every case) ----------
const GLOSSARY: Record<string, [string, string][]> = {
  "en-ar": [
    ["cache", "الكاش"], // transliteration
    ["token", "التوكن"], // transliteration
    ["commit", "كوميت"], // transliteration
    ["deploy", "نشر"], // real word
    ["branch", "فرع"], // real word
    ["pull request", "طلب دمج"], // multi-word, real words
    ["dark mode", "الوضع الداكن"], // multi-word, real words
  ],
  "en-fr": [
    ["cache", "antémémoire"], // real (uncommon) word, overrides the loanword
    ["token", "jeton"],
    ["commit", "validation"],
    ["branch", "branche"],
  ],
  "en-de": [
    ["cache", "Zwischenspeicher"],
    ["branch", "Zweig"],
  ],
};

type Case = { id: string; kind: "glossary" | "placeholder"; src: string; tgt: string; text: string; note: string };

const CASES: Case[] = [
  // Glossary (--mode, runPipeline exactly as TranslationSession.translate does, no context)
  { id: "G1-ar-cache", kind: "glossary", src: "en", tgt: "ar", text: "Clear the cache before restarting the server.", note: "short term, transliteration" },
  { id: "G2-ar-token", kind: "glossary", src: "en", tgt: "ar", text: "Your session token has expired.", note: "short term, transliteration" },
  { id: "G3-ar-commit", kind: "glossary", src: "en", tgt: "ar", text: "Every commit must be signed.", note: "short term, transliteration" },
  { id: "G4-ar-deploy", kind: "glossary", src: "en", tgt: "ar", text: "Deploy the app to production.", note: "short term, real word (verb)" },
  { id: "G5-ar-branch", kind: "glossary", src: "en", tgt: "ar", text: "Create a new branch for this feature.", note: "short term, real word" },
  { id: "G6-ar-pr", kind: "glossary", src: "en", tgt: "ar", text: "Open a pull request when you are ready.", note: "multi-word, real words" },
  { id: "G7-ar-darkmode", kind: "glossary", src: "en", tgt: "ar", text: "Enable dark mode in the settings.", note: "multi-word, real words" },
  { id: "G8-ar-cache-twice", kind: "glossary", src: "en", tgt: "ar", text: "The cache is full, so clear the cache now.", note: "term appears twice" },
  { id: "G9-ar-three", kind: "glossary", src: "en", tgt: "ar", text: "Push the commit to the remote branch, then deploy.", note: "3 terms (2 real, 1 translit)" },
  { id: "G10-fr-cache", kind: "glossary", src: "en", tgt: "fr", text: "Clear the cache before restarting the server.", note: "fr, non-default rendering" },
  { id: "G11-fr-two", kind: "glossary", src: "en", tgt: "fr", text: "Push the commit to the remote branch.", note: "fr, 2 terms" },
  { id: "G12-de-cache", kind: "glossary", src: "en", tgt: "de", text: "Clear the cache before restarting the server.", note: "de, compound noun" },
  { id: "G13-de-branch", kind: "glossary", src: "en", tgt: "de", text: "Create a new branch for this feature.", note: "de, real word" },
  // Placeholders (file mode: translateFile on a one-key JSON, --mode glossary mode)
  { id: "P1-ar-one", kind: "placeholder", src: "en", tgt: "ar", text: "Hello {name}, welcome back!", note: "1 placeholder" },
  { id: "P2-ar-two", kind: "placeholder", src: "en", tgt: "ar", text: "You have {{count}} new messages from {sender}.", note: "2 placeholders" },
  { id: "P3-ar-three", kind: "placeholder", src: "en", tgt: "ar", text: "%s uploaded {{count}} files to {folder}.", note: "3 placeholders" },
  { id: "P4-ar-glossary", kind: "placeholder", src: "en", tgt: "ar", text: "Cleared the {name} cache.", note: "placeholder adjacent to glossary term" },
  { id: "P5-fr-three", kind: "placeholder", src: "en", tgt: "fr", text: "%s uploaded {{count}} files to {folder}.", note: "fr, 3 placeholders" },
  { id: "P6-de-three", kind: "placeholder", src: "en", tgt: "de", text: "%s uploaded {{count}} files to {folder}.", note: "de, 3 placeholders" },
];

// ---------- instrumented adapter ----------
type Call = {
  prompt: string;
  rawOutput: string;
  stripped: string;
  missingTerms: string[];
  sentinelsIn: string[];
  sentinelsOut: string[];
  ms: number;
  error?: string;
  repair?: boolean; // an agreement repair call, not a translation attempt
};

const SENT_RE = /__TLPH_\d+__/g;

class RecordingAdapter implements Adapter {
  calls: Call[] = [];
  constructor(private readonly inner: Adapter) {}
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { prompt } = buildStructuredPrompt(request);
    const t0 = performance.now();
    try {
      const res = await this.inner.translate(request);
      const stripped = normalizeWhitespace(stripGlossaryTags(res.translated));
      this.calls.push({
        prompt,
        rawOutput: res.translated,
        stripped,
        missingTerms: computeGlossaryCoverage(request.glossaryHits ?? [], stripped).missingTerms,
        sentinelsIn: request.source.match(SENT_RE) ?? [],
        sentinelsOut: res.translated.match(SENT_RE) ?? [],
        ms: Math.round(performance.now() - t0),
        repair: !!request.repairTerms,
      });
      return res;
    } catch (err) {
      this.calls.push({ prompt, rawOutput: "", stripped: "", missingTerms: [], sentinelsIn: [], sentinelsOut: [], ms: Math.round(performance.now() - t0), error: String(err) });
      throw err;
    }
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

type RunResult = {
  run: number;
  success: boolean;
  attempts: number; // every model call, agreement repairs included
  repairs: number; // agreement repair calls (#115)
  errorTag?: string;
  errorMessage?: string;
  missingTerms: string[];
  output?: string;
  durationMs: number;
  calls?: Call[]; // only kept for failures (and every first-attempt output kept separately)
  firstOutput: string;
};

// ---------- setup ----------
async function main(): Promise<void> {
  const tags = await fetch(`${DEFAULT_OLLAMA_URL}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags) throw new Error(`Ollama not reachable at ${DEFAULT_OLLAMA_URL}`);

  const dir = mkdtempSync(join(tmpdir(), "tl-bench-"));
  const glossary = new GlossaryStore(join(dir, "glossary.db"));
  const context = new ContextStore(join(dir, "context.db"));
  for (const [pair, entries] of Object.entries(GLOSSARY)) {
    const [sourceLang, targetLang] = pair.split("-");
    glossary.addMany(entries.map(([sourceTerm, targetTerm]) => ({ sourceTerm, targetTerm, sourceLang, targetLang })));
  }
  const inner = new TranslateGemmaLocalAdapter(DEFAULT_MODEL, DEFAULT_OLLAMA_URL);
  const rec = new RecordingAdapter(inner);

  const cases = ONLY ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;
  const results: Record<string, RunResult[]> = {};
  const started = Date.now();
  console.log(`tmp dir: ${dir}\nmodel: ${DEFAULT_MODEL}  mode: ${MODE}  runs: ${RUNS}  cases: ${cases.length}\n`);

  try {
    for (const c of cases) {
      results[c.id] = [];
      for (let run = 0; run < RUNS; run++) {
        rec.calls = [];
        const t0 = performance.now();
        const r: RunResult = { run, success: false, attempts: 0, repairs: 0, missingTerms: [], durationMs: 0, firstOutput: "" };
        if (c.kind === "glossary") {
          try {
            const res = await runPipeline(c.text, c.src, c.tgt, rec, glossary, { glossaryMode: MODE, maxRetries: MAX_RETRIES });
            r.success = true;
            r.output = res.translated;
          } catch (err) {
            r.errorTag = err instanceof TlError ? err.tag : "UNKNOWN";
            r.errorMessage = err instanceof Error ? err.message : String(err);
          }
          r.missingTerms = rec.calls.at(-1)?.missingTerms ?? [];
        } else {
          const caseDir = join(dir, `${c.id}-${run}`);
          mkdirSync(caseDir);
          const sourcePath = join(caseDir, `${c.src}.json`);
          const outPath = join(caseDir, `${c.tgt}.json`);
          writeFileSync(sourcePath, JSON.stringify({ msg: c.text }, null, 2));
          try {
            const summary = await translateFile({
              sourcePath, outPath, sourceLang: c.src, targetLang: c.tgt,
              adapter: rec, glossary, context, glossaryMode: MODE,
            });
            const f = summary.failed[0];
            r.success = summary.translated === 1 && !f;
            if (f) { r.errorTag = f.tag; r.errorMessage = f.reason; }
            r.output = JSON.parse(readFileSync(outPath, "utf8")).msg;
          } catch (err) {
            r.errorTag = err instanceof TlError ? err.tag : "UNKNOWN";
            r.errorMessage = err instanceof Error ? err.message : String(err);
          }
          r.missingTerms = (rec.calls.at(-1)?.missingTerms ?? []).filter((t) => !t.startsWith("__TLPH_"));
        }
        if (MODE === "prefer" && r.success) {
          // Nothing throws for a miss in prefer mode: check the final output.
          r.missingTerms = computeGlossaryCoverage(glossary.findMatches(c.text, c.src, c.tgt), r.output ?? "").missingTerms;
          if (r.missingTerms.length > 0) {
            r.success = false;
            r.errorTag = "GLOSSARY_MISS";
          }
        }
        r.attempts = rec.calls.length;
        r.repairs = rec.calls.filter((call) => call.repair).length;
        r.durationMs = Math.round(performance.now() - t0);
        r.firstOutput = rec.calls[0]?.rawOutput ?? "";
        if (!r.success || r.attempts > 1) r.calls = rec.calls;
        results[c.id].push(r);
        process.stdout.write(`${c.id} run ${run + 1}/${RUNS}: ${r.success ? "ok" : "FAIL " + r.errorTag} attempts=${r.attempts} repairs=${r.repairs} ${r.durationMs}ms\n`);
      }
    }
  } finally {
    await rec.dispose();
    glossary.close();
    context.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // ---------- report ----------
  const rows = cases.map((c) => {
    const rs = results[c.id];
    const ok = rs.filter((r) => r.success).length;
    return {
      id: c.id,
      kind: c.kind,
      success: `${ok}/${rs.length}`,
      rate: ok / rs.length,
      meanAttempts: +(rs.reduce((a, r) => a + r.attempts, 0) / rs.length).toFixed(2),
      repairs: rs.reduce((a, r) => a + r.repairs, 0),
      firstTryOk: rs.filter((r) => r.success && r.attempts - r.repairs === 1).length,
      distinctFirstOutputs: new Set(rs.map((r) => r.firstOutput)).size,
      meanMs: Math.round(rs.reduce((a, r) => a + r.durationMs, 0) / rs.length),
      note: c.note,
    };
  });
  console.log();
  console.table(rows.map(({ rate, ...r }) => r));
  const overall = (kind: Case["kind"]) => {
    const rs = cases.filter((c) => c.kind === kind).flatMap((c) => results[c.id]);
    return rs.length ? `${rs.filter((r) => r.success).length}/${rs.length} (${((100 * rs.filter((r) => r.success).length) / rs.length).toFixed(1)}%)` : "n/a";
  };
  const totalMin = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nOverall glossary success:    ${overall("glossary")}`);
  console.log(`Overall placeholder success: ${overall("placeholder")}`);
  console.log(`Total time: ${totalMin} min`);

  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ model: DEFAULT_MODEL, mode: MODE, runs: RUNS, maxRetries: MAX_RETRIES, glossary: GLOSSARY, summary: rows, overall: { glossary: overall("glossary"), placeholder: overall("placeholder") }, cases, results }, null, 2),
  );
  console.log(`Results: ${outFile}`);
}

await main();
