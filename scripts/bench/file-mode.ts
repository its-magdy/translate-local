#!/usr/bin/env bun
/**
 * Benchmark: file mode (`tl translate --file`) on a 131-leaf dev-dashboard
 * catalog, against the real TranslateGemma model via Ollama. Measures what a
 * catalog costs (model calls, agreement repair calls) and how many repairs
 * land, per target language.
 *
 *   bun run scripts/bench/file-mode.ts [--langs fr,de,ar] [--runs N] [--mode prefer|strict] [--label name]
 *
 * Each run translates scripts/bench/fixtures/dashboard.en.json from scratch
 * with translateFile() exactly as the CLI does (missing-only, continue on
 * error, default context settings). Per language it reports:
 *   - calls: every adapter call (attempts, glossary/placeholder retries, repairs)
 *   - repairs: the pipeline's agreement repair calls (#115), also in calls
 *   - applied: leaves whose final value is a repair's output
 *   - termMiss: leaves with a glossary hit whose final value lacks a target
 *     term or form (Arabic `ل` + `ال` merge counted as the term, harakat dropped)
 *   - failed: leaves that fell back to source
 *   - lcStart: leaves with a glossary hit whose source starts with an
 *     uppercase letter and whose value starts with a lowercase one
 *
 * `applied` is read from the output: a leaf counts when its value equals a
 * repair response run through the pipeline's own postprocessing and unmasked,
 * and differs from the draft. That is exact for this catalog because none of
 * its values take the ICU path (simple `{name}` arguments are plain
 * placeholders), so the bench refuses a fixture that has ICU values.
 *
 * Uses the core/adapters sources directly with temp SQLite dbs under a mkdtemp
 * dir (never ~/.config/tl). Model settings are the app defaults. Results
 * (every leaf's output, calls and the raw output of each call) are written to
 * scripts/bench/results/<label>-<timestamp>.json (label defaults to "file-mode").
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter, AdapterResponse, TranslationRequest } from "../../packages/shared/src/types";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "../../packages/shared/src/constants";
import { computeGlossaryCoverage, normalizeWhitespace, stripGlossaryTags } from "../../packages/shared/src/utils/text";
import { TranslateGemmaLocalAdapter } from "../../packages/adapters/src/translate-gemma/local";
import { GlossaryStore } from "../../packages/core/src/glossary";
import { ContextStore } from "../../packages/core/src/context";
import { fixTermAgreement } from "../../packages/core/src/agreement";
import { translateFile, pipelineTranslator } from "../../packages/core/src/files/index";
import { containsICU, mask, unmask } from "../../packages/core/src/files/placeholders";

// ---------- args ----------
const argv = process.argv.slice(2);
const argVal = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const LANGS = (argVal("--langs") ?? "fr,de,ar").split(",");
const RUNS = Number(argVal("--runs") ?? 1);
const LABEL = argVal("--label") ?? "file-mode";
const MODE = argVal("--mode") ?? "prefer";
if (MODE !== "strict" && MODE !== "prefer") throw new Error(`--mode must be strict or prefer, got ${MODE}`);
const GLOSSARY_MODE: "strict" | "prefer" = MODE;

// ---------- glossary (one per language pair) ----------
// Targets match the text benches where they overlap; `deploy → bereitstellen`
// is a verb term, so it lists the other forms German needs (noun, participle,
// zu-infinitive, separable verb) as glossary forms.
const GLOSSARY: Record<string, [string, string, string[]?][]> = {
  "en-fr": [
    ["server", "hôte"], ["cache", "antémémoire"], ["commit", "validation"], ["branch", "branche"],
    ["token", "jeton"], ["repository", "dépôt"],
  ],
  "en-de": [
    ["cache", "Zwischenspeicher"], ["branch", "Zweig"],
    ["deploy", "bereitstellen", ["Bereitstellung", "bereitgestellt", "bereitzustellen", "stellen … bereit", "stellt … bereit"]],
  ],
  "en-ar": [
    ["cache", "الكاش"], ["token", "التوكن"], ["commit", "كوميت"], ["deploy", "نشر"], ["branch", "فرع"],
    ["pull request", "طلب دمج"],
  ],
};

const FIXTURE = join(import.meta.dir, "fixtures", "dashboard.en.json");

/** Every string leaf as [dotted path, value]. */
function leaves(node: unknown, prefix: string[] = []): [string, string][] {
  if (typeof node === "string") return [[prefix.join("."), node]];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => leaves(v, [...prefix, k]));
  return [];
}

/** `ل` + an `ال`-initial term, as written: `للتوكن`, or `للغة` when the stem starts with `ل`. */
const arMerged = (term: string): string => (term[2] === "ل" ? "ل" : "لل") + term.slice(2);
/** Coverage that counts the correct `ل` + `ال` merge as the term, with harakat dropped. */
const forCoverage = (text: string, terms: string[]): string =>
  terms.reduce(
    (t, term) => (term.startsWith("ال") ? t.split(arMerged(term)).join("ل" + term) : t),
    text.replace(/[ً-ْ]/g, ""),
  );

// ---------- instrumented adapter ----------
type Call = { repair: boolean; source: string; raw: string };
class CountingAdapter implements Adapter {
  leaf = "";
  calls = new Map<string, Call[]>();
  constructor(private readonly inner: Adapter) {}
  async translate(request: TranslationRequest): Promise<AdapterResponse> {
    const res = await this.inner.translate(request);
    const list = this.calls.get(this.leaf) ?? [];
    list.push({ repair: !!request.repairTerms, source: request.source, raw: res.translated });
    this.calls.set(this.leaf, list);
    return res;
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

async function main(): Promise<void> {
  const tags = await fetch(`${DEFAULT_OLLAMA_URL}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags) throw new Error(`Ollama not reachable at ${DEFAULT_OLLAMA_URL}`);

  const source = leaves(JSON.parse(readFileSync(FIXTURE, "utf8")));
  const icu = source.filter(([, v]) => containsICU(v));
  if (icu.length > 0) throw new Error(`fixture has ICU values (applied repairs can't be read from the output): ${icu.map(([p]) => p).join(", ")}`);

  const dir = mkdtempSync(join(tmpdir(), "tl-filebench-"));
  const glossary = new GlossaryStore(join(dir, "glossary.db"));
  const context = new ContextStore(join(dir, "context.db"));
  for (const [pair, entries] of Object.entries(GLOSSARY)) {
    const [sourceLang, targetLang] = pair.split("-");
    glossary.addMany(entries.map(([sourceTerm, targetTerm, forms]) => ({ sourceTerm, targetTerm, sourceLang, targetLang, forms })));
  }
  const rec = new CountingAdapter(new TranslateGemmaLocalAdapter(DEFAULT_MODEL, DEFAULT_OLLAMA_URL));
  const rows: Record<string, unknown>[] = [];
  const all: Record<string, unknown[]> = {};
  console.log(`tmp dir: ${dir}\nmodel: ${DEFAULT_MODEL}  mode: ${MODE}  runs: ${RUNS}  leaves: ${source.length}  langs: ${LANGS.join(",")}\n`);

  try {
    for (const tgt of LANGS) {
      const t = { leaves: 0, calls: 0, repairs: 0, applied: 0, hitLeaves: 0, termMiss: 0, lcStart: 0, failed: 0, ms: 0 };
      all[tgt] = [];
      for (let run = 0; run < RUNS; run++) {
        const outPath = join(dir, `${tgt}-${run}.json`);
        rec.calls = new Map();
        const t0 = performance.now();
        const summary = await translateFile({
          sourcePath: FIXTURE, outPath, sourceLang: "en", targetLang: tgt,
          translator: pipelineTranslator(rec, glossary, context, { glossaryMode: GLOSSARY_MODE }),
          onProgress: ({ path }) => { rec.leaf = path; },
        });
        const dt = performance.now() - t0;
        const out = new Map(leaves(JSON.parse(readFileSync(outPath, "utf8"))));
        const failed = new Set(summary.failed.map((f) => f.path));
        let calls = 0, repairs = 0, applied = 0, hitLeaves = 0, termMiss = 0, lcStart = 0;
        const perLeaf: unknown[] = [];
        for (const [path, src] of source) {
          const value = out.get(path) ?? "";
          const leafCalls = rec.calls.get(path) ?? [];
          const terms = [...new Set(glossary.findMatches(src, "en", tgt).map((h) => h.entry.targetTerm))];
          const { placeholders } = mask(src);
          const post = (raw: string): string =>
            unmask(fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw)), tgt, terms), placeholders);
          const leafRepairs = leafCalls.filter((c) => c.repair);
          const wasApplied = leafRepairs.some((c) => value === post(c.raw) && value !== unmask(c.source, placeholders));
          const missing = terms.length === 0 || failed.has(path)
            ? []
            : computeGlossaryCoverage(glossary.findMatches(src, "en", tgt), forCoverage(value, terms)).missingTerms;
          calls += leafCalls.length; repairs += leafRepairs.length; applied += +wasApplied;
          hitLeaves += +(terms.length > 0); termMiss += +(missing.length > 0);
          lcStart += +(terms.length > 0 && !failed.has(path) && /^\p{Lu}/u.test(src) && /^\p{Ll}/u.test(value));
          perLeaf.push({ path, source: src, value, failed: failed.has(path), terms, missing, applied: wasApplied, calls: leafCalls });
        }
        t.leaves += source.length; t.calls += calls; t.repairs += repairs; t.applied += applied;
        t.hitLeaves += hitLeaves; t.termMiss += termMiss; t.lcStart += lcStart; t.failed += summary.failed.length; t.ms += dt;
        all[tgt].push({ summary, leaves: perLeaf });
        console.log(`${tgt} run ${run + 1}/${RUNS}: calls=${calls} repairs=${repairs} applied=${applied} termMiss=${termMiss}/${hitLeaves} lcStart=${lcStart} failed=${summary.failed.length} skipped=${summary.skipped.count} ${Math.round(dt / 1000)}s`);
      }
      rows.push({
        lang: tgt, runs: RUNS, calls: t.calls, callsPerLeaf: +(t.calls / t.leaves).toFixed(2), repairs: t.repairs, applied: t.applied,
        termMiss: `${t.termMiss}/${t.hitLeaves}`, lcStart: `${t.lcStart}/${t.hitLeaves}`, failed: t.failed, meanSec: Math.round(t.ms / RUNS / 1000),
      });
    }
  } finally {
    await rec.dispose();
    glossary.close();
    context.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log();
  console.table(rows);
  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ model: DEFAULT_MODEL, mode: MODE, runs: RUNS, glossary: GLOSSARY, rows, all }, null, 2));
  console.log(`Results: ${outFile}`);
}

await main();
