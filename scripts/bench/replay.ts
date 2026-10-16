#!/usr/bin/env bun
/**
 * Offline replay of saved file-mode bench runs: no model needed.
 *
 *   bun run scripts/bench/replay.ts [--out digest.json] [--diff baseline.json] [results/*.json …]
 *
 * For every scripts/bench/results/*.json written by file-mode.ts (or the
 * files given), each saved run is translated again with translateFile() on the
 * bench fixture, the run's glossary and glossary mode, and an adapter that
 * answers every request with the raw output the model gave to the same
 * request (same `source`, translation or repair) in that run, in call order.
 * A request with no saved answer is echoed back and counted as `unanswered`;
 * saved answers the code never asked for are counted as `unused`.
 *
 * The output (every leaf's value plus those counts) depends only on the
 * pipeline's code, so running this before and after a change and comparing
 * the digests shows exactly which leaves the change affects. A refactor that
 * must not change behaviour has to print the same digest. `--diff` lists the
 * leaves (and counts) that differ from a digest saved earlier with `--out`.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import type { Adapter, AdapterResponse, TranslationRequest } from "../../packages/shared/src/types";
import { GlossaryStore } from "../../packages/core/src/glossary";
import { ContextStore } from "../../packages/core/src/context";
import { translateFile } from "../../packages/core/src/files/index";

type Call = { repair: boolean; source: string; raw: string };
type SavedRun = { leaves: { path: string; calls: Call[] }[] };
type Saved = { mode?: "prefer" | "strict"; glossary: Record<string, [string, string, string[]?][]>; all: Record<string, SavedRun[]> };

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : undefined;
const diffIdx = argv.indexOf("--diff");
const DIFF = diffIdx >= 0 ? argv.splice(diffIdx, 2)[1] : undefined;
const RESULTS = join(import.meta.dir, "results");
const FIXTURE = join(import.meta.dir, "fixtures", "dashboard.en.json");
const files = argv.length > 0 ? argv : readdirSync(RESULTS).filter((f) => f.endsWith(".json")).sort().map((f) => join(RESULTS, f));

/** Answers each request from the saved calls of one run, per (kind, source), in order. */
class ReplayAdapter implements Adapter {
  private readonly queues = new Map<string, string[]>();
  unanswered = 0;
  constructor(run: SavedRun) {
    for (const leaf of run.leaves) {
      for (const c of leaf.calls) {
        const key = `${c.repair ? "R" : "T"}\u0000${c.source}`;
        this.queues.set(key, [...(this.queues.get(key) ?? []), c.raw]);
      }
    }
  }
  async translate(request: TranslationRequest): Promise<AdapterResponse> {
    const raw = this.queues.get(`${request.repairTerms ? "R" : "T"}\u0000${request.source}`)?.shift();
    if (raw === undefined) this.unanswered++;
    return { translated: raw ?? request.source, metadata: { adapter: "replay", durationMs: 0 } };
  }
  get unused(): number {
    return [...this.queues.values()].reduce((n, q) => n + q.length, 0);
  }
  async dispose(): Promise<void> {}
}

const isFileMode = (d: unknown): d is Saved => {
  const all = (d as Saved)?.all;
  return !!all && typeof all === "object" && Object.values(all).every((runs) => Array.isArray(runs) && runs.every((r) => Array.isArray(r?.leaves) && r.leaves.every((l) => Array.isArray(l.calls))));
};

const dir = mkdtempSync(join(tmpdir(), "tl-replay-"));
const digest: Record<string, unknown> = {};
let leafCount = 0, unanswered = 0, unused = 0;
try {
  for (const file of files) {
    const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isFileMode(saved)) continue;
    const name = file.split(/[\\/]/).pop()!;
    const glossary = new GlossaryStore(join(dir, `${name}.glossary.db`));
    const context = new ContextStore(join(dir, `${name}.context.db`));
    try {
      for (const [pair, entries] of Object.entries(saved.glossary)) {
        const [sourceLang, targetLang] = pair.split("-");
        glossary.addMany(entries.map(([sourceTerm, targetTerm, forms]) => ({ sourceTerm, targetTerm, sourceLang, targetLang, forms })));
      }
      for (const [tgt, runs] of Object.entries(saved.all)) {
        for (const [i, run] of runs.entries()) {
          const adapter = new ReplayAdapter(run);
          const outPath = join(dir, `${name}-${tgt}-${i}.json`);
          const summary = await translateFile({
            sourcePath: FIXTURE, outPath, sourceLang: "en", targetLang: tgt,
            adapter, glossary, context, glossaryMode: saved.mode ?? "prefer",
          });
          const key = `${name} ${tgt} #${i}`;
          digest[key] = { out: JSON.parse(readFileSync(outPath, "utf8")), failed: summary.failed.map((f) => f.pointer), unanswered: adapter.unanswered, unused: adapter.unused };
          leafCount += summary.totalLeaves; unanswered += adapter.unanswered; unused += adapter.unused;
        }
      }
    } finally {
      glossary.close();
      context.close();
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const text = JSON.stringify(digest, null, 1);
if (OUT) writeFileSync(OUT, text);
console.log(`runs: ${Object.keys(digest).length}  leaves: ${leafCount}  unanswered: ${unanswered}  unused: ${unused}`);
console.log(`digest: ${createHash("sha256").update(text).digest("hex")}`);

if (DIFF) {
  const base = JSON.parse(readFileSync(DIFF, "utf8")) as Record<string, Record<string, unknown>>;
  const flat = (node: unknown, prefix = ""): [string, unknown][] =>
    node && typeof node === "object" ? Object.entries(node).flatMap(([k, v]) => flat(v, `${prefix}/${k}`)) : [[prefix, node]];
  let changed = 0;
  for (const key of new Set([...Object.keys(base), ...Object.keys(digest)])) {
    const before = new Map(flat(base[key]));
    const after = new Map(flat(digest[key]));
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(path) === after.get(path)) continue;
      changed++;
      console.log(`${key} ${path}\n  - ${JSON.stringify(before.get(path))}\n  + ${JSON.stringify(after.get(path))}`);
    }
  }
  console.log(`differences from ${DIFF}: ${changed}`);
  if (changed > 0) process.exitCode = 1;
}
