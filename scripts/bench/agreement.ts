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
 * as neither. Arabic outputs are scored with harakat removed, and the
 * `ل` + `ال` merge (`للتوكن`) counts as the term. `repairs` counts the
 * pipeline's agreement repair calls (also included in the calls count) and
 * `applied` the runs whose final text is the repaired one.
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
const modeArg = argVal("--mode") ?? "prefer";
if (modeArg !== "strict" && modeArg !== "prefer") throw new Error(`--mode must be strict or prefer, got ${modeArg}`);
const MODE: "strict" | "prefer" = modeArg;
// Same default as config.ts `glossary.maxRetries`.
const MAX_RETRIES = 2;

// ---------- glossary (one per language pair, shared by every case) ----------
const GLOSSARY: Record<string, [string, string][]> = {
  "en-fr": [["server", "hôte"], ["cache", "antémémoire"], ["commit", "validation"]],
  "en-de": [["branch", "Zweig"], ["cache", "Zwischenspeicher"]],
  "en-it": [["server", "host"]],
  "en-ar": [["token", "التوكن"], ["cache", "الكاش"], ["language", "اللغة"]],
};

const AP = "['’]";
const FR_REJECT = /\b(le|au|du) hôte|«/i;
/** `ل` + an `ال`-initial term, as written: `للتوكن`, or `للغة` when the stem starts with `ل`. */
const arMerged = (term: string): string => (term[2] === "ل" ? "ل" : "لل") + term.slice(2);
/** The term attached to its context: bare, after و/ف/ب/ك proclitics, or merged with ل. */
const arAttached = (term: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\u0640])(?:[وف]?[بك]?${term}|[وف]?${arMerged(term)})`, "u");
/** A detached or doubled article: `لـ التوكن`, `ل التوكن`, `لالتوكن`, `الالتوكن`, any tatweel. */
const arDetached = (term: string): RegExp => new RegExp(`\\u0640|(?<!\\p{L})ل\\s+${term}|لا?${term}`, "u");
/** Drops Arabic harakat (`للّغة` → `للغة`) before scoring; a no-op for other scripts. */
const stripHarakat = (text: string): string => text.replace(/[\u064B-\u0652]/g, "");
/** Coverage that counts the correct `ل` + `ال` merge as the term, so a merged output is not a miss. */
const splitArMerge = (text: string, terms: string[]): string =>
  terms.reduce((t, term) => (term.startsWith("ال") ? t.split(arMerged(term)).join("ل" + term) : t), text);
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
  // Arabic `ال`-initial terms after the preposition ل (#125): `ل` + `التوكن` is
  // written `للتوكن`, and `ل` + `اللغة` is `للغة` (the article's lam merges too).
  { id: "A12-ar-reserved", tgt: "ar", text: "This space is reserved for the token.", expect: arAttached("التوكن"), reject: arDetached("التوكن") },
  { id: "A13-ar-useful", tgt: "ar", text: "This option is useful for the cache.", expect: arAttached("الكاش"), reject: arDetached("الكاش") },
  { id: "A14-ar-name", tgt: "ar", text: "Choose a name for the cache.", expect: arAttached("الكاش"), reject: arDetached("الكاش") },
  { id: "A15-ar-support", tgt: "ar", text: "Support for the language is limited.", expect: arAttached("اللغة"), reject: arDetached("اللغة") },
];

// ---------- instrumented adapter ----------
class CountingAdapter implements Adapter {
  raws: string[] = [];
  repairs = 0; // agreement repair calls (#115), also counted in raws
  constructor(private readonly inner: Adapter) {}
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (request.repairTerms) this.repairs++;
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
  let tTerm = 0, tAgree = 0, tCalls = 0, tMs = 0, tN = 0, tRepairs = 0, tRepaired = 0;
  console.log(`tmp dir: ${dir}\nmodel: ${DEFAULT_MODEL}  mode: ${MODE}  runs: ${RUNS}  cases: ${cases.length}\n`);

  try {
    for (const c of cases) {
      let term = 0, agree = 0, calls = 0, ms = 0, repairs = 0, repaired = 0;
      const outs: unknown[] = [];
      for (let i = 0; i < RUNS; i++) {
        rec.raws = [];
        rec.repairs = 0;
        const t0 = performance.now();
        let out = "";
        let failed = false;
        let wasRepaired = false;
        try {
          const res = await runPipeline(c.text, "en", c.tgt, rec, glossary, { glossaryMode: MODE, maxRetries: MAX_RETRIES });
          out = res.translated;
          wasRepaired = !!res.metadata.repaired;
        } catch (err) {
          failed = true;
          out = `ERROR ${err instanceof Error ? err.message : String(err)}`;
        }
        const dt = performance.now() - t0;
        const hits = glossary.findMatches(c.text, "en", c.tgt);
        const plain = stripHarakat(out);
        const termOk = !failed && computeGlossaryCoverage(hits, splitArMerge(plain, hits.map((h) => h.entry.targetTerm))).missingTerms.length === 0;
        const agreeOk = termOk && c.expect.test(plain.trim()) && !(c.reject?.test(plain) ?? false);
        term += +termOk; agree += +agreeOk; calls += rec.raws.length; ms += dt; repairs += rec.repairs; repaired += +wasRepaired;
        outs.push({ out, termOk, agreeOk, calls: rec.raws.length, repairs: rec.repairs, repaired: wasRepaired, raws: rec.raws });
        console.log(`${c.id} ${i + 1}/${RUNS}: term=${termOk ? "ok" : "MISS"} agree=${agreeOk ? "ok" : "BAD"} calls=${rec.raws.length} repair=${rec.repairs ? (wasRepaired ? "applied" : "unchanged") : "-"} ${Math.round(dt)}ms  ${JSON.stringify(out)}`);
      }
      tTerm += term; tAgree += agree; tCalls += calls; tMs += ms; tN += RUNS; tRepairs += repairs; tRepaired += repaired;
      all[c.id] = outs;
      rows.push({ id: c.id, term: `${term}/${RUNS}`, agree: `${agree}/${RUNS}`, repairs, applied: repaired, meanCalls: +(calls / RUNS).toFixed(2), meanMs: Math.round(ms / RUNS) });
    }
  } finally {
    await rec.dispose();
    glossary.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log();
  console.table(rows);
  const total = `term ${tTerm}/${tN}  agree ${tAgree}/${tN}  repairs ${tRepairs} (applied ${tRepaired})  meanCalls ${(tCalls / tN).toFixed(2)}  meanMs ${Math.round(tMs / tN)}`;
  console.log(`\nTOTAL ${total}`);

  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ model: DEFAULT_MODEL, mode: MODE, runs: RUNS, maxRetries: MAX_RETRIES, glossary: GLOSSARY, total, rows, all }, null, 2));
  console.log(`Results: ${outFile}`);
}

await main();
