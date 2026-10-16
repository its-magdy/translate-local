#!/usr/bin/env bun
/**
 * Probe: the pipeline's tag check (tagCheckCandidates / checkKeepsWord) against
 * the real TranslateGemma model via Ollama. Each case replays a saved model
 * output that tags another word while the glossary term is already outside
 * the tags; the pipeline then makes its check call (the code-switched source)
 * to the real model and keeps the tagged word or replaces it with the term.
 *
 *   bun run scripts/bench/tag-check-probe.ts [--runs N] [--only <caseId,...>] [--label name]
 *
 * Cases (sources and glossaries from the file-mode and strict-glossary benches):
 *   - T1-de-deploy-auto: the tag wraps `Automatisch` ("automatically"); keeping
 *     it is right, so the keep rate should be high (want ≥ 80%).
 *   - T2-fr-repository-mirror: the tag wraps `répertoire`, the model's word for
 *     "repository" itself (the outside `dépôt` translates "remote"); keeping it
 *     is wrong, so the false-keep rate should be 0.
 *   - T3-fr-G11: the tag wraps `d'origine` ("remote"); keeping it is right.
 *
 * Each run is one real call: the first attempt is answered with the saved
 * output, the check goes to the model, and the agreement repair (if any) gets
 * its draft back without a model call. A run is a keep when the result has
 * `metadata.keptWord`.
 *
 * Uses the core/adapters sources directly with a temp SQLite glossary under a
 * mkdtemp dir (never ~/.config/tl). Model settings are the app defaults.
 * Results (every check call's source and raw output, and each final text) are
 * written to scripts/bench/results/<label>-<timestamp>.json (label defaults to
 * "tag-check-probe").
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter, AdapterResponse, TranslationRequest } from "../../packages/shared/src/types";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "../../packages/shared/src/constants";
import { tagCheckCandidates } from "../../packages/shared/src/utils/text";
import { TranslateGemmaLocalAdapter } from "../../packages/adapters/src/translate-gemma/local";
import { GlossaryStore } from "../../packages/core/src/glossary";
import { runPipeline } from "../../packages/core/src/pipeline";

// ---------- args ----------
const argv = process.argv.slice(2);
const argVal = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Number(argVal("--runs") ?? 20);
const ONLY = argVal("--only")?.split(",");
const LABEL = argVal("--label") ?? "tag-check-probe";

type Case = {
  id: string;
  tgt: string;
  text: string;
  glossary: [string, string, string[]?][];
  /** The saved first-attempt output that triggers the check. */
  raw: string;
  /** Whether keeping the tagged word is the right decision. */
  keepIsRight: boolean;
};
const CASES: Case[] = [
  {
    id: "T1-de-deploy-auto", tgt: "de", text: "Deploy automatically after each commit.",
    glossary: [["cache", "Zwischenspeicher"], ["branch", "Zweig"], ["deploy", "bereitstellen", ["Bereitstellung", "bereitgestellt", "bereitzustellen", "stellen … bereit", "stellt … bereit"]]],
    raw: '<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.',
    keepIsRight: true,
  },
  {
    id: "T2-fr-repository-mirror", tgt: "fr", text: "Mirror the repository to a second remote.",
    glossary: [["server", "hôte"], ["cache", "antémémoire"], ["commit", "validation"], ["branch", "branche"], ["token", "jeton"], ["repository", "dépôt"]],
    raw: 'Copier le <term translation="dépôt">répertoire</term> vers un autre dépôt distant.',
    keepIsRight: false,
  },
  {
    id: "T3-fr-G11", tgt: "fr", text: "Push the commit to the remote branch.",
    glossary: [["cache", "antémémoire"], ["token", "jeton"], ["commit", "validation"], ["branch", "branche"]],
    raw: 'Envoyez la validation vers la branche <term translation="branche">d\'origine</term>.',
    keepIsRight: true,
  },
];

// ---------- adapter: saved first attempt, real check, no-op repair ----------
type Call = { kind: "attempt" | "check" | "repair"; source: string; raw: string };
class ProbeAdapter implements Adapter {
  calls: Call[] = [];
  constructor(private readonly inner: Adapter, private readonly first: string) {}
  async translate(request: TranslationRequest): Promise<AdapterResponse> {
    const kind = request.repairTerms ? "repair" : this.calls.length === 0 ? "attempt" : "check";
    const res = kind === "check"
      ? await this.inner.translate(request)
      : { translated: kind === "repair" ? request.source : this.first, metadata: { adapter: "probe", durationMs: 0 } };
    this.calls.push({ kind, source: request.source, raw: res.translated });
    return res;
  }
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

async function main(): Promise<void> {
  const tags = await fetch(`${DEFAULT_OLLAMA_URL}/api/tags`).then((r) => r.json()).catch(() => null);
  if (!tags) throw new Error(`Ollama not reachable at ${DEFAULT_OLLAMA_URL}`);

  const dir = mkdtempSync(join(tmpdir(), "tl-tagcheck-"));
  const glossary = new GlossaryStore(join(dir, "glossary.db"));
  const model = new TranslateGemmaLocalAdapter(DEFAULT_MODEL, DEFAULT_OLLAMA_URL);
  const cases = ONLY ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;
  const rows: Record<string, unknown>[] = [];
  const all: Record<string, unknown[]> = {};
  console.log(`tmp dir: ${dir}\nmodel: ${DEFAULT_MODEL}  runs: ${RUNS}  cases: ${cases.length}\n`);

  try {
    for (const c of cases) {
      for (const [sourceTerm, targetTerm, forms] of c.glossary) glossary.add({ sourceTerm, targetTerm, sourceLang: "en", targetLang: c.tgt, forms });
      const hits = glossary.findMatches(c.text, "en", c.tgt);
      const forms = new Map(hits.map((h) => [h.entry.targetTerm, h.entry.forms ?? []]));
      const candidates = tagCheckCandidates(c.raw, hits, forms);
      if (candidates.size === 0) throw new Error(`${c.id}: the saved output does not trigger the tag check`);
      all[c.id] = [];
      let keeps = 0, checks = 0, errors = 0;
      for (let run = 0; run < RUNS; run++) {
        const adapter = new ProbeAdapter(model, c.raw);
        try {
          const result = await runPipeline(c.text, "en", c.tgt, adapter, glossary);
          checks += +!!result.metadata.tagChecked;
          keeps += +!!result.metadata.keptWord;
          const check = adapter.calls.find((x) => x.kind === "check");
          all[c.id].push({ final: result.translated, keptWord: !!result.metadata.keptWord, calls: adapter.calls });
          console.log(`${c.id} run ${run + 1}/${RUNS}: ${result.metadata.keptWord ? "KEEP " : "strip"}  check: ${check?.raw ?? "(none)"}`);
        } catch (err) {
          errors++;
          all[c.id].push({ error: String(err), calls: adapter.calls });
          console.log(`${c.id} run ${run + 1}/${RUNS}: error ${err}`);
        }
      }
      rows.push({
        case: c.id, runs: RUNS, checks, keeps, keepRate: `${Math.round((100 * keeps) / RUNS)}%`,
        [c.keepIsRight ? "want" : "falseKeeps"]: c.keepIsRight ? "≥80% keep" : keeps, errors,
      });
      // One glossary per case: the cases share language pairs with different entries.
      for (const e of glossary.list("en", c.tgt)) glossary.remove(e.id);
    }
  } finally {
    await model.dispose();
    glossary.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log();
  console.table(rows);
  const outDir = join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ model: DEFAULT_MODEL, runs: RUNS, cases: CASES, rows, all }, null, 2));
  console.log(`Results: ${outFile}`);
}

await main();
