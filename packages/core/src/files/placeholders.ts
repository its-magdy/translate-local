// ASCII sentinels survive translategemma reliably; PUA chars (U+E000/U+E001) get
// stripped from the model output entirely. The `__TLPH_` prefix is unlikely to
// appear in real i18n content. The prefix/suffix live in shared constants so
// adapter prompt builders enforce the exact same token format.
import type { GlossaryHit } from "@translate-local/shared/types";
import {
  PLACEHOLDER_SENTINEL_PREFIX as SENTINEL_PREFIX,
  PLACEHOLDER_SENTINEL_SUFFIX as SENTINEL_SUFFIX,
} from "@translate-local/shared/constants";

/** The sentinel token that mask() substitutes for the placeholder at `index`. */
export function sentinelFor(index: number): string {
  return `${SENTINEL_PREFIX}${index}${SENTINEL_SUFFIX}`;
}

// i18next, with optional formatting: {{count, number}}, {{val, currency(USD)}}.
const I18NEXT = /\{\{\s*[\w.]+\s*(?:,[^{}]*)?\}\}/.source;
const RAILS = /%\{[\w.]+\}/.source;
const I18NEXT_NESTING = /\$t\([^)]+\)/.source;
const VUE_LINKED = /@(?:\.\w+)?:[\w.]+/.source;
const BRACES = /\{\s*[\w.]+\s*\}/.source;
const PRINTF_POSITIONAL = /%\d+\$[sdif]/.source;
const PRINTF = /%[sdif]/.source;
const MARKUP = /<\/?[a-zA-Z][^>]*>/.source;

const combine = (sources: string[]) => new RegExp(sources.map((s) => `(?:${s})`).join("|"), "g");

// Order matters: longer/more-specific patterns first so `{{name}}` matches as one token.
const COMBINED = combine([I18NEXT, RAILS, I18NEXT_NESTING, VUE_LINKED, BRACES, PRINTF_POSITIONAL, PRINTF, MARKUP]);

// Text mode masks only the forms that don't occur in prose: not markup
// (`<b>`), Vue linked keys (`@:x`, an email has `@`) or `$t(x)`.
const TEXT_COMBINED = combine([I18NEXT, RAILS, BRACES, PRINTF_POSITIONAL, PRINTF]);

// `(?<!\{)`: i18next's `{{val, number}}` is interpolation, not ICU.
const ICU = /(?<!\{)\{[^{}]*,\s*(?:plural|select|selectordinal|number|date|time|spellout|ordinal|duration|choice)\s*[,}]/;

// The ICU arguments with branches. i18next has no equivalent, so in an i18next
// catalog these can't be translated as plain text.
const ICU_BRANCHING = /(?<!\{)\{[^{}]*,\s*(?:plural|select|selectordinal)\s*,/;

const SENTINEL_RE = new RegExp(`${SENTINEL_PREFIX}(\\d+)${SENTINEL_SUFFIX}`, "g");

export type Placeholder = { raw: string; index: number };

export type ValidationResult = {
  ok: boolean;
  missing: string[];
  extra: string[];
};

export function containsICU(text: string): boolean {
  return ICU.test(text);
}

export function containsICUBranching(text: string): boolean {
  return ICU_BRANCHING.test(text);
}

export function extract(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  let i = 0;
  for (const m of text.matchAll(COMBINED)) {
    out.push({ raw: m[0], index: i++ });
  }
  return out;
}

export function mask(text: string): { masked: string; placeholders: Placeholder[] } {
  const placeholders: Placeholder[] = [];
  return { masked: maskAppend(text, placeholders), placeholders };
}

/** mask() for text mode (TranslationSession.translate): only the placeholder forms that don't occur in prose. */
export function maskText(text: string): { masked: string; placeholders: Placeholder[] } {
  const placeholders: Placeholder[] = [];
  return { masked: maskWith(TEXT_COMBINED, text, placeholders), placeholders };
}

/** mask() that appends to an existing list, so sentinel indices continue from its length. */
export function maskAppend(text: string, placeholders: Placeholder[]): string {
  return maskWith(COMBINED, text, placeholders);
}

function maskWith(pattern: RegExp, text: string, placeholders: Placeholder[]): string {
  return text.replace(pattern, (m) => {
    const index = placeholders.length;
    placeholders.push({ raw: m, index });
    return sentinelFor(index);
  });
}

/** Sentinel indices in `masked`, in order of appearance. */
export function sentinelIndices(masked: string): number[] {
  return [...masked.matchAll(SENTINEL_RE)].map((m) => parseInt(m[1], 10));
}

/** Splits `masked` into text runs (strings) and sentinel indices (numbers). */
export function splitSentinels(masked: string): (string | number)[] {
  const out: (string | number)[] = [];
  let last = 0;
  for (const m of masked.matchAll(SENTINEL_RE)) {
    if (m.index > last) out.push(masked.slice(last, m.index));
    out.push(parseInt(m[1], 10));
    last = m.index + m[0].length;
  }
  if (last < masked.length) out.push(masked.slice(last));
  return out;
}

export function unmask(masked: string, placeholders: Placeholder[]): string {
  return masked.replace(SENTINEL_RE, (_match, idx: string) => {
    const ph = placeholders[parseInt(idx, 10)];
    return ph ? ph.raw : "";
  });
}

/**
 * Wraps a stream's onChunk so it gets the text with its placeholders back. A
 * sentinel's term tag is written as the placeholder, as the tag strip writes
 * its attribute. A chunk ending in what could start a sentinel (`__TL`,
 * `__TLPH_1`) or inside a term tag (`<te`, `<term …>x</ter`) is held until a
 * later chunk completes it. A held tail the stream ends on is not written:
 * frontends print the final translation when it differs from the stream.
 */
export function unmaskStream(onChunk: (chunk: string) => void, placeholders: Placeholder[]): (chunk: string) => void {
  let pending = "";
  return (chunk) => {
    pending += chunk;
    const cut = Math.min(partialSentinelStart(pending), openTermTagStart(pending));
    const ready = pending.slice(0, cut);
    pending = pending.slice(cut);
    if (ready) onChunk(unmask(ready.replace(SENTINEL_TAG_RE, "$1"), placeholders));
  };
}

const SENTINEL_TAG_RE = new RegExp(`<term translation="(${SENTINEL_PREFIX}\\d+${SENTINEL_SUFFIX})"[^>]*>[^<]*</term>`, "g");

/** Where a term tag `text` ends inside (opened, not yet closed, or a partial `<term`/`</term>`) starts, or text.length. */
function openTermTagStart(text: string): number {
  const open = text.lastIndexOf("<term");
  if (open !== -1 && !text.includes("</term>", open)) return open;
  for (let i = Math.max(0, text.length - "</term>".length); i < text.length; i++) {
    const tail = text.slice(i);
    if (["<term", "</term>"].some((tag) => tail.length < tag.length && tag.startsWith(tail))) return i;
  }
  return text.length;
}

// Prefix, up to 10 digits, suffix: the longest tail that can still be an incomplete sentinel.
const MAX_PARTIAL = SENTINEL_PREFIX.length + 10 + SENTINEL_SUFFIX.length;

/** Where the incomplete sentinel `text` ends on starts, or text.length. */
function partialSentinelStart(text: string): number {
  // Not inside a complete sentinel: its `__` suffix also starts a prefix.
  let from = Math.max(0, text.length - MAX_PARTIAL);
  for (const m of text.matchAll(SENTINEL_RE)) from = Math.max(from, m.index + m[0].length);
  for (let i = from; i < text.length; i++) {
    if (isPartialSentinel(text.slice(i))) return i;
  }
  return text.length;
}

function isPartialSentinel(tail: string): boolean {
  if (SENTINEL_PREFIX.startsWith(tail)) return true;
  if (!tail.startsWith(SENTINEL_PREFIX)) return false;
  const rest = /^(\d*)(.*)$/s.exec(tail.slice(SENTINEL_PREFIX.length))!;
  if (rest[1] === "") return rest[2] === "";
  return rest[2].length < SENTINEL_SUFFIX.length && SENTINEL_SUFFIX.startsWith(rest[2]);
}

// translategemma reliably honors <term> tags from the glossary path; routing
// sentinels through that channel preserves them better than naked-token instructions.
// The pipeline only tags them (no strict-mode enforcement or coverage), so a
// dropped sentinel reaches the caller's placeholder check and retry loop.
export function sentinelHits(text: string, indices: number[], sourceLang: string, targetLang: string): GlossaryHit[] {
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

export function validate(source: string, translated: string): ValidationResult {
  const srcCounts = new Map<string, number>();
  const tgtCounts = new Map<string, number>();
  for (const p of extract(source)) srcCounts.set(p.raw, (srcCounts.get(p.raw) ?? 0) + 1);
  for (const p of extract(translated)) tgtCounts.set(p.raw, (tgtCounts.get(p.raw) ?? 0) + 1);

  const missing: string[] = [];
  const extra: string[] = [];

  for (const [raw, n] of srcCounts) {
    const t = tgtCounts.get(raw) ?? 0;
    for (let k = 0; k < n - t; k++) missing.push(raw);
  }
  for (const [raw, n] of tgtCounts) {
    const s = srcCounts.get(raw) ?? 0;
    for (let k = 0; k < n - s; k++) extra.push(raw);
  }

  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}
