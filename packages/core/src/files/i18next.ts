// i18next v4 plural regeneration. A source catalog carries the SOURCE locale's
// plural keys (en: `item_one`, `item_other`); the target needs its own CLDR
// categories (ar: zero/one/two/few/many/other, ja: other only). Before
// translation the source tree is rewritten so every plural group holds exactly
// the target's keys — sync, translation, and writing then run unchanged on it.
//
// Each generated key carries a PluralHint: a sample count for its category. The
// orchestrator substitutes it for {{count}} so the model sees "3 files" rather
// than an opaque placeholder and inflects the noun for that category.

import { isMap, isScalar, isSeq, type Document, type Pair, type Scalar, type YAMLMap } from "yaml";
import type { JsonValue } from "./walk";
import { pluralCategories, pluralRules, pluralSample, PLURAL_CATEGORIES, type PluralCategory, type PluralType } from "./plurals";

export type PluralHint = { value: number; exact: boolean };

export type PluralRegenResult = {
  /** Source tree with each plural group rewritten to the target's categories. */
  data: JsonValue;
  /** Sample count per generated leaf, keyed by pathKey(path). */
  hints: Map<string, PluralHint>;
  /** True when a group was left as-is because the target's categories are unknown. */
  unresolved: boolean;
};

const PLURAL_KEY = /^(.+?)(_ordinal)?_(zero|one|two|few|many|other)$/;
const COUNT_PLACEHOLDER = /^\{\{\s*count\s*\}\}$/;

export const pathKey = (path: (string | number)[]): string => JSON.stringify(path);

/** True for the i18next count interpolation — the value plural selection runs on. */
export const isCountPlaceholder = (raw: string): boolean => COUNT_PLACEHOLDER.test(raw);

type Langs = { sourceLang: string; targetLang: string };

// `group` marks a generated plural key; `anchor` (first key of a group only) is
// the original key whose position the group took.
type PlanEntry = { key: string; from: string; hint?: PluralHint; group?: boolean; anchor?: string };

type Group = { stem: string; type: PluralType; members: Map<PluralCategory, string>; strings: boolean };

// The new key order for one map, or null when it holds no regenerable group.
// Group keys collapse to the position of the group's first key, in CLDR order.
function planKeys(entries: { key: string; isString: boolean }[], langs: Langs, state: { unresolved: boolean }): PlanEntry[] | null {
  const groups = new Map<string, Group>();
  const groupOf = new Map<string, Group>();
  for (const { key, isString } of entries) {
    const m = key.match(PLURAL_KEY);
    if (!m) continue;
    const type: PluralType = m[2] ? "ordinal" : "cardinal";
    const id = `${type}:${m[1]}`;
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { stem: m[1], type, members: new Map(), strings: true }));
    g.members.set(m[3] as PluralCategory, key);
    g.strings &&= isString;
    groupOf.set(key, g);
  }

  const known = langs.sourceLang !== "auto";
  const plans = new Map<Group, PlanEntry[]>();
  for (const g of groups.values()) {
    // `_other` exists in every locale, so a real group always has it. A lone
    // `_other` is only a group when the source language uses nothing else.
    const sourceCats = known ? pluralCategories(langs.sourceLang, g.type) : null;
    const lone = g.members.size === 1 && sourceCats?.length === 1;
    if (!g.members.has("other") || !g.strings || (g.members.size < 2 && !lone)) continue;
    const plan = planGroup(g, langs);
    if (plan) plans.set(g, plan);
    else state.unresolved = true;
  }
  if (plans.size === 0) return null;

  const out: PlanEntry[] = [];
  const emitted = new Set<Group>();
  for (const { key } of entries) {
    const g = groupOf.get(key);
    const plan = g && plans.get(g);
    if (!plan) {
      out.push({ key, from: key });
    } else if (!emitted.has(g)) {
      emitted.add(g);
      out.push({ ...plan[0], anchor: key }, ...plan.slice(1));
    }
  }
  return out;
}

function planGroup(g: Group, { sourceLang, targetLang }: Langs): PlanEntry[] | null {
  const targetCats = pluralCategories(targetLang, g.type);
  if (!targetCats) return null;
  const srcRules = sourceLang === "auto" ? null : pluralRules(sourceLang, g.type);
  // i18next uses `_zero` for count 0 in every language, not just those with a
  // zero category, so a source `_zero` is kept (cardinal only).
  const zeroOverride = g.type === "cardinal" && g.members.has("zero");
  const cats = PLURAL_CATEGORIES.filter((c) => targetCats.includes(c) || (c === "zero" && zeroOverride));
  const prefix = `${g.stem}${g.type === "ordinal" ? "_ordinal" : ""}_`;

  return cats.map((cat) => {
    let base: PluralCategory;
    let hint: PluralHint | null;
    if (cat === "zero" && zeroOverride) {
      base = "zero";
      hint = { value: 0, exact: !targetCats.includes("zero") || (pluralSample(targetLang, "zero", g.type)?.exact ?? true) };
    } else if (srcRules) {
      // Base the form on the source text i18next would show for the same count.
      hint = pluralSample(targetLang, cat, g.type);
      const shown = hint ? (srcRules.select(hint.value) as PluralCategory) : cat;
      base = g.members.has(shown) ? shown : "other";
    } else {
      base = g.members.has(cat) ? cat : "other";
      // 1 is the singular in nearly every source language — a poor sample for `_other` text.
      hint = pluralSample(targetLang, cat, g.type, base === "other" ? 1 : undefined);
    }
    return { key: prefix + cat, from: g.members.get(base)!, group: true, ...(hint ? { hint } : {}) };
  });
}

/** Rewrite every i18next plural group in `root` to the target locale's categories. Does not mutate `root`. */
export function regenerateI18nextPlurals(root: JsonValue, sourceLang: string, targetLang: string): PluralRegenResult {
  const hints = new Map<string, PluralHint>();
  const state = { unresolved: false };
  const langs = { sourceLang, targetLang };

  const visit = (node: JsonValue, path: (string | number)[]): JsonValue => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((v, i) => visit(v, [...path, i]));
    const entries = Object.entries(node);
    const plan: PlanEntry[] = planKeys(entries.map(([key, v]) => ({ key, isString: typeof v === "string" })), langs, state)
      ?? entries.map(([key]) => ({ key, from: key }));
    const out: { [k: string]: JsonValue } = {};
    for (const e of plan) {
      out[e.key] = e.group ? node[e.from] : visit(node[e.from], [...path, e.key]);
      if (e.hint) hints.set(pathKey([...path, e.key]), e.hint);
    }
    return out;
  };

  return { data: visit(root, []), hints, unresolved: state.unresolved };
}

const keyString = (pair: Pair): string => (isScalar(pair.key) ? String((pair.key as Scalar).value) : String(pair.key));

/**
 * Apply the same rewrite to the YAML document used as the write template, so
 * generated keys sit where the source group was. Each generated pair is a clone
 * of its base pair (keeping scalar style); the comment above the group moves to
 * its first key, other comments inside the group are dropped.
 */
export function regenerateYamlPlurals(doc: Document.Parsed, sourceLang: string, targetLang: string): void {
  const langs = { sourceLang, targetLang };
  const state = { unresolved: false };

  const visit = (node: unknown): void => {
    if (isSeq(node)) {
      for (const item of node.items) visit(item);
      return;
    }
    if (!isMap(node)) return;
    const map = node as YAMLMap;
    const pairs = map.items as Pair[];
    const byKey = new Map(pairs.map((p) => [keyString(p), p]));
    const plan = planKeys(
      pairs.map((p) => ({ key: keyString(p), isString: isScalar(p.value) && typeof (p.value as Scalar).value === "string" })),
      langs,
      state,
    );
    if (!plan) {
      for (const p of pairs) visit(p.value);
      return;
    }

    const items: Pair[] = [];
    for (const e of plan) {
      const original = byKey.get(e.from)!;
      if (!e.group) {
        visit(original.value);
        items.push(original);
        continue;
      }
      const pair = original.clone() as Pair;
      if (isScalar(pair.key)) (pair.key as Scalar).value = e.key;
      else pair.key = doc.createNode(e.key);
      const key = pair.key as Scalar;
      const value = pair.value as Scalar;
      const anchorKey = e.anchor === undefined ? undefined : byKey.get(e.anchor)!.key;
      const above = isScalar(anchorKey) ? (anchorKey as Scalar) : undefined;
      key.commentBefore = above?.commentBefore;
      key.spaceBefore = above?.spaceBefore;
      value.commentBefore = undefined;
      value.comment = undefined;
      items.push(pair);
    }
    map.items = items;
  };

  visit(doc.contents);
}

