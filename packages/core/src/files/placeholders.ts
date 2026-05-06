/**
 * Placeholder protection for file translation.
 *
 * Strategy: hybrid mask + validate. Replace placeholders with ASCII sentinels
 * (`__TLPH_N__`) before sending to the model, restore after, then re-extract
 * from the model's output and check multiset equality against the source.
 *
 * Why ASCII sentinels: tested with translategemma (the default backend),
 * Unicode Private Use Area chars (U+E000/U+E001) get stripped from the
 * model output entirely. Plain ASCII tokens with a distinctive shape survive
 * translation reliably. The `__TLPH_` prefix is unlikely to appear in real
 * i18n content.
 *
 * Order in COMBINED matters: longer/more-specific patterns first so the regex
 * engine matches `{{name}}` as one placeholder rather than `{name}` plus stray braces.
 */

const SENTINEL_PREFIX = "__TLPH_";
const SENTINEL_SUFFIX = "__";

const PATTERN_SOURCES = [
  /\{\{\s*[\w.]+\s*\}\}/.source,        // i18next / mustache: {{name}}
  /%\{[\w.]+\}/.source,                  // Rails: %{name}
  /\$t\([^)]+\)/.source,                 // i18next nesting: $t(key)
  /@(?:\.\w+)?:[\w.]+/.source,           // Vue I18n linked: @:key, @.upper:key
  /\{\s*[\w.]+\s*\}/.source,             // ICU simple / Vue: {name}, {0}
  /%\d+\$[sdif]/.source,                  // Positional printf: %1$s, %2$d
  /%[sdif]/.source,                       // printf: %s, %d, %f
  /<\/?[a-zA-Z][^>]*>/.source,            // HTML tags: <b>, </a>, <br/>
];

const COMBINED = new RegExp(PATTERN_SOURCES.map((s) => `(?:${s})`).join("|"), "g");

// ICU MessageFormat detector: plural, select, selectordinal, number/date/time formats.
// We refuse strings containing these in v1 — partial translation is a footgun without
// a full ICU AST parser.
const ICU = /\{[^{}]*,\s*(?:plural|select|selectordinal|number|date|time|spellout|ordinal|duration|choice)\s*,/;

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
  let i = 0;
  const masked = text.replace(COMBINED, (m) => {
    const idx = i++;
    placeholders.push({ raw: m, index: idx });
    return `${SENTINEL_PREFIX}${idx}${SENTINEL_SUFFIX}`;
  });
  return { masked, placeholders };
}

export function unmask(masked: string, placeholders: Placeholder[]): string {
  return masked.replace(SENTINEL_RE, (_match, idx: string) => {
    const ph = placeholders[parseInt(idx, 10)];
    return ph ? ph.raw : "";
  });
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
