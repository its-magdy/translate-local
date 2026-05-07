// ASCII sentinels survive translategemma reliably; PUA chars (U+E000/U+E001) get
// stripped from the model output entirely. The `__TLPH_` prefix is unlikely to
// appear in real i18n content.
const SENTINEL_PREFIX = "__TLPH_";
const SENTINEL_SUFFIX = "__";

// Order matters: longer/more-specific patterns first so `{{name}}` matches as one token.
const PATTERN_SOURCES = [
  /\{\{\s*[\w.]+\s*\}\}/.source,
  /%\{[\w.]+\}/.source,
  /\$t\([^)]+\)/.source,
  /@(?:\.\w+)?:[\w.]+/.source,
  /\{\s*[\w.]+\s*\}/.source,
  /%\d+\$[sdif]/.source,
  /%[sdif]/.source,
  /<\/?[a-zA-Z][^>]*>/.source,
];

const COMBINED = new RegExp(PATTERN_SOURCES.map((s) => `(?:${s})`).join("|"), "g");

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
