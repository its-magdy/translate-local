// What happens to one leaf of a catalog. planLeaf() decides it without a model
// call (keep the source, refuse, or translate), so a dry run and a real run
// agree; translateLeaf() translates a leaf through a TranslateText function and
// returns its outcome. translateFile applies plans and outcomes to the target
// catalog, the summary and the lock.

import type { GlossaryHit } from "@translate-local/shared/types";
import { TlError, type ErrorTag } from "@translate-local/shared/errors";
import type { ContentFormat } from "./detect";
import { mask, unmask, validate, containsICU, containsICUBranching, sentinelFor, sentinelIndices } from "./placeholders";
import { parseICU, translateICU, type UnitTranslator } from "./icu";
import { classifyValue } from "./skip";
import { isCountPlaceholder, type PluralHint } from "./i18next";
import { sampleRegex } from "./plurals";

// 10 retries gives ~99.9% success at ~50% per-attempt rate; cost is paid only on stubborn keys.
const MAX_PLACEHOLDER_RETRIES = 10;

// Attempts that show the model a sample count (e.g. "3 files") for a plural
// form before falling back to translating the bare placeholder text.
const PLURAL_HINT_ATTEMPTS = 3;

const I18NEXT_ICU_HINT =
  "i18next does not evaluate ICU plural/select, so the value is not translated. Use i18next plural keys (key_one, key_other). If this is an ICU catalog misdetected as i18next because of _one/_other keys, pass --format raw-json (or raw-yaml) to translate ICU values structure-preserving; that also skips i18next plural regeneration. The default run keeps the source for these keys.";
const INVALID_ICU_HINT =
  "Fix the ICU syntax in the source value. The default run continues and falls back to source for these keys; --strict aborts instead.";
const PLACEHOLDER_HINT =
  "The model output dropped or altered placeholders across all retries. Pass --strict only if you want abort-on-failure; otherwise the default continues with source-as-fallback.";

/** Why a leaf could not be translated: recorded as failed, or thrown by strictError() under --strict. */
export type LeafFailure = {
  message: string;
  /** The tag --strict would throw; also reported in the summary. */
  tag: ErrorTag;
  hint: string;
  /** Set when the pipeline itself threw; rethrown as-is under --strict. */
  pipelineError?: unknown;
};

export type LeafPlan =
  /** Copied verbatim: FormatJS metadata (`metadata`) or a skip heuristic's reason. */
  | { kind: "keep"; reason: string }
  /** Fails without a model call, in a dry run too. */
  | { kind: "refuse"; failure: LeafFailure; icuInI18next: boolean }
  | { kind: "translate"; icu: boolean };

export type LeafOutcome =
  /** `unhinted`: a plural form translated without its sample count. */
  | { kind: "translated"; value: string; unhinted: boolean }
  | { kind: "failed"; failure: LeafFailure };

/** One translation unit through the pipeline: the text sent and its sentinel hits, the raw translation back. */
export type TranslateText = (text: string, hits: GlossaryHit[]) => Promise<string>;

export function planLeaf(
  source: string,
  path: (string | number)[],
  pathStr: string,
  opts: { content: ContentFormat; translateAll: boolean },
): LeafPlan {
  // FormatJS: only defaultMessage is a message; description and friends are
  // notes for translators and are copied verbatim.
  if (opts.content === "formatjs" && path[path.length - 1] !== "defaultMessage") {
    return { kind: "keep", reason: "metadata" };
  }

  if (!opts.translateAll) {
    const cls = classifyValue(source);
    if (cls.skip) return { kind: "keep", reason: cls.reason };
  }

  // i18next doesn't speak ICU: a single-brace "{x, number}" there is literal text.
  const icu = opts.content === "formatjs" || (opts.content !== "i18next-plurals" && containsICU(source));

  // A plural/select in an i18next catalog would reach the model as literal
  // text and come back garbled, so keep the source and report it.
  if (opts.content === "i18next-plurals" && containsICUBranching(source)) {
    const reason = `ICU MessageFormat in an i18next catalog at ${pathStr}`;
    return { kind: "refuse", icuInI18next: true, failure: { message: reason, tag: "FILE_INVALID_FORMAT", hint: I18NEXT_ICU_HINT } };
  }

  if (icu) {
    try {
      parseICU(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { kind: "refuse", icuInI18next: false, failure: { message: `Invalid ICU MessageFormat at ${pathStr}: ${msg}`, tag: "FILE_INVALID_FORMAT", hint: INVALID_ICU_HINT } };
    }
  }

  return { kind: "translate", icu };
}

/** The error --strict throws for a failed leaf. */
export function strictError(failure: LeafFailure): unknown {
  if (failure.pipelineError !== undefined) return failure.pipelineError;
  return new TlError(failure.tag, failure.message, failure.hint);
}

/** A cancelled model call: the run was aborted, the leaf did not fail. */
export function isCancelled(err: unknown): boolean {
  const cause = err instanceof LeafFailed ? err.pipelineError : err;
  return cause instanceof TlError && cause.tag === "CANCELLED";
}

/** Control flow inside translateLeaf; translateICU rethrows it because it carries `pipelineError`. */
class LeafFailed extends Error {
  constructor(
    message: string,
    readonly pipelineError?: unknown,
  ) {
    super(message);
  }

  get failure(): LeafFailure {
    if (this.pipelineError === undefined) return { message: this.message, tag: "PLACEHOLDER_MISMATCH", hint: PLACEHOLDER_HINT };
    // A non-TlError pipeline error reaches the CLI as TRANSLATION_FAILED.
    const tag = this.pipelineError instanceof TlError ? this.pipelineError.tag : "TRANSLATION_FAILED";
    return { message: this.message, tag, hint: PLACEHOLDER_HINT, pipelineError: this.pipelineError };
  }
}

// translategemma reliably honors <term> tags from the glossary path; routing
// sentinels through that channel preserves them better than naked-token instructions.
// The pipeline only tags them (no strict-mode enforcement or coverage), so a
// dropped sentinel reaches translateLeaf's placeholder check and retry loop.
function sentinelHits(text: string, indices: number[], sourceLang: string, targetLang: string): GlossaryHit[] {
  const hits: GlossaryHit[] = [];
  for (const index of indices) {
    const tok = sentinelFor(index);
    const idx = text.indexOf(tok);
    if (idx < 0) continue;
    hits.push({
      entry: { id: `__sentinel_${index}`, sourceTerm: tok, targetTerm: tok, sourceLang, targetLang },
      startIndex: idx,
      endIndex: idx + tok.length,
    });
  }
  return hits;
}

/**
 * Translates a leaf planned for translation, retrying placeholder failures.
 * `hint` is the leaf's plural sample (PluralRegenResult.hints). A cancelled
 * model call is thrown (see isCancelled); every other failure is the outcome.
 */
export async function translateLeaf(
  source: string,
  pathStr: string,
  opts: { icu: boolean; sourceLang: string; targetLang: string; hint?: PluralHint | null },
  translate: TranslateText,
): Promise<LeafOutcome> {
  try {
    return await translateOrThrow(source, pathStr, opts, translate);
  } catch (err) {
    if (!(err instanceof LeafFailed)) throw err;
    if (isCancelled(err)) throw err.pipelineError;
    return { kind: "failed", failure: err.failure };
  }
}

async function translateOrThrow(
  source: string,
  pathStr: string,
  opts: { icu: boolean; sourceLang: string; targetLang: string; hint?: PluralHint | null },
  translate: TranslateText,
): Promise<LeafOutcome> {
  const { sourceLang, targetLang, hint } = opts;
  const pipelineFailed = (err: unknown): LeafFailed => {
    const msg = err instanceof Error ? err.message : String(err);
    return new LeafFailed(`Pipeline failed at ${pathStr}: ${msg}`, err);
  };

  // Runs the pipeline on `text` until `check` accepts the output (null =
  // accepted), retrying placeholder failures. Throws LeafFailed on give-up.
  const retry = async (
    text: string,
    hits: GlossaryHit[],
    check: (out: string) => string | null,
    firstAttempt = 0,
  ): Promise<string> => {
    let lastReason = "";
    for (let attempt = firstAttempt; attempt < MAX_PLACEHOLDER_RETRIES; attempt++) {
      let out: string;
      try {
        out = await translate(text, hits);
      } catch (err) {
        throw pipelineFailed(err);
      }
      const problem = check(out);
      if (problem === null) return out;
      lastReason = `Placeholder mismatch at ${pathStr} (attempt ${attempt + 1}/${MAX_PLACEHOLDER_RETRIES}) — ${problem}`;
    }
    throw new LeafFailed(lastReason);
  };

  if (opts.icu) {
    const runUnit: UnitTranslator = (masked, check) =>
      retry(masked, sentinelHits(masked, sentinelIndices(masked), sourceLang, targetLang), check);
    try {
      return { kind: "translated", value: await translateICU(source, targetLang, runUnit), unhinted: false };
    } catch (err) {
      if (err instanceof LeafFailed) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new LeafFailed(`ICU validation failed at ${pathStr}: ${msg}`);
    }
  }

  const { masked, placeholders } = mask(source);
  const indices = placeholders.map((ph) => ph.index);
  const mismatch = (expected: string, restored: string): string | null => {
    if (placeholders.length === 0) return null;
    const v = validate(expected, restored);
    return v.ok ? null : `missing: [${v.missing.join(", ")}], extra: [${v.extra.join(", ")}]`;
  };

  // For a plural form, swap {{count}} for the category's sample number so the
  // model inflects for it ("3 files", not "__TLPH_0__ files"); the number is
  // swapped back to the placeholder after translation.
  const counts = hint ? placeholders.filter((ph) => isCountPlaceholder(ph.raw)) : [];
  // A form that should have had a sample but can't: no {{count}} in its text
  // (and the category spans several numbers), or every sample collides with
  // a literal number in the text (hint === null).
  const hintMissed = hint === null || (hint !== undefined && counts.length === 0 && !hint.exact);
  const hinted = hint != null && counts.length > 0;
  if (hinted) {
    let text = masked;
    for (const ph of counts) text = text.split(sentinelFor(ph.index)).join(String(hint.value));
    // Markup stays raw in the hinted text: translategemma keeps `<b>3</b>`
    // but drops sentinels glued to a bare number (`__TLPH_0__3__TLPH_2__`).
    // Raw tags in the output still pass validate(), which compares raw forms.
    for (const ph of placeholders) {
      if (ph.raw.startsWith("<")) text = text.split(sentinelFor(ph.index)).join(ph.raw);
    }
    const hits = sentinelHits(text, indices, sourceLang, targetLang);
    const countTok = sentinelFor(counts[0].index);
    const re = sampleRegex(hint.value, targetLang);
    for (let attempt = 0; attempt < PLURAL_HINT_ATTEMPTS; attempt++) {
      let out: string;
      try {
        out = await translate(text, hits);
      } catch (err) {
        // A sample count can derail the model (e.g. Ollama aborting on a
        // repeated "0" token for 1000000) — move on to the plain text instead.
        if (err instanceof TlError && (err.tag === "ADAPTER_UNAVAILABLE" || err.tag === "CANCELLED")) throw pipelineFailed(err);
        continue;
      }
      let expected = source;
      const swapped = out.replace(re, countTok);
      if (swapped !== out) {
        out = swapped;
      } else if (hint.exact) {
        // The category holds only this number (Arabic dual = 2), so a
        // translation that spells it out or drops it ("ملفان") is still right.
        expected = placeholders.filter((ph) => !isCountPlaceholder(ph.raw)).map((ph) => ph.raw).join(" ");
      } else {
        continue;
      }
      const restored = unmask(out, placeholders);
      if (mismatch(expected, restored) === null) return { kind: "translated", value: restored, unhinted: false };
    }
  }

  // The plain attempts continue the numbering after the hinted ones.
  const out = await retry(
    masked,
    sentinelHits(masked, indices, sourceLang, targetLang),
    (o) => mismatch(source, unmask(o, placeholders)),
    hinted ? PLURAL_HINT_ATTEMPTS : 0,
  );
  return { kind: "translated", value: unmask(out, placeholders), unhinted: hinted || hintMissed };
}
