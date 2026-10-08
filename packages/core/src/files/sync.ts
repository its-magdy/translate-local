import { walkLeaves, getAtPath, type JsonValue } from "./walk";

export type SyncMode = "missing-only" | "force";

export type PendingTranslation = {
  path: (string | number)[];
  source: string;
  set: (next: string) => void;
  /** True when queued only because the source changed (the target already had a value). */
  changed: boolean;
};

export function diffForSync(
  sourceRoot: JsonValue,
  targetRoot: JsonValue,
  mode: SyncMode,
  isChanged?: (path: (string | number)[], source: string) => boolean,
): PendingTranslation[] {
  const out: PendingTranslation[] = [];

  for (const leaf of walkLeaves(sourceRoot)) {
    const queue = (changed: boolean) =>
      out.push({ path: leaf.path, source: leaf.value, set: makeTargetSetter(targetRoot, leaf.path), changed });
    const existing = getAtPath(targetRoot, leaf.path);
    if (mode === "force" || needsTranslation(existing)) {
      queue(false);
    } else if (typeof existing === "string" && isChanged?.(leaf.path, leaf.value)) {
      // Only a string can be re-translated in place; a target of another shape
      // (e.g. a plural map under a source string) is kept, as in missing-only.
      queue(true);
    }
  }

  return out;
}

// A target legitimately carries more plural forms than its source (en has
// one/other, ar adds zero/two/few/many), so prune must recognize plural forms
// in every common layout. All six CLDR categories are accepted rather than only
// the target locale's Intl.PluralRules set: that set is always a subset of
// these six. Applied regardless of detected format.
const CLDR_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);
// i18next v4: `stem_<category>` / `stem_ordinal_<category>`.
const PLURAL_KEY_RE = /^(.+?)_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;
// i18next v3 (compatibilityJSON "v3"): `stem_plural`, and `stem_<n>` for
// languages with more than two forms (ar: item_0 … item_5).
const V3_PLURAL_KEY_RE = /^(.+?)_(?:\d+|plural)$/;

function isPluralFormOfSourceKey(key: string, source: { [k: string]: JsonValue }): boolean {
  // Nested-map plurals (Rails / Ruby i18n, some JSON libraries): inside a map
  // whose source keys are all categories, every category key is a plural form.
  const sourceKeys = Object.keys(source);
  if (CLDR_CATEGORIES.has(key) && sourceKeys.length > 0 && sourceKeys.every((k) => CLDR_CATEGORIES.has(k))) return true;

  const v4 = key.match(PLURAL_KEY_RE);
  if (v4) {
    const stem = v4[1];
    if (Object.hasOwn(source, stem) || sourceKeys.some((sk) => sk.match(PLURAL_KEY_RE)?.[1] === stem)) return true;
  }
  const v3 = key.match(V3_PLURAL_KEY_RE);
  if (v3) {
    const stem = v3[1];
    if (Object.hasOwn(source, stem) || Object.hasOwn(source, `${stem}_plural`)) return true;
  }
  return false;
}

/**
 * Remove keys and array elements from `targetRoot` that have no counterpart in
 * `sourceRoot`. Mutates in place and returns the removed paths. Only recurses
 * where both sides have the same container shape; a shape mismatch (source
 * string vs target plural map) is left alone, as in sync.
 */
export function pruneTarget(sourceRoot: JsonValue, targetRoot: JsonValue): (string | number)[][] {
  const removed: (string | number)[][] = [];
  const visit = (src: JsonValue, tgt: JsonValue, path: (string | number)[]): void => {
    if (src === null || tgt === null || typeof src !== "object" || typeof tgt !== "object") return;
    if (Array.isArray(src) && Array.isArray(tgt)) {
      for (let i = src.length; i < tgt.length; i++) removed.push([...path, i]);
      if (tgt.length > src.length) tgt.length = src.length;
      for (let i = 0; i < tgt.length; i++) visit(src[i], tgt[i], [...path, i]);
      return;
    }
    if (Array.isArray(src) || Array.isArray(tgt)) return;
    const s = src as { [k: string]: JsonValue };
    const t = tgt as { [k: string]: JsonValue };
    for (const k of Object.keys(t)) {
      if (!Object.hasOwn(s, k) && !isPluralFormOfSourceKey(k, s)) {
        removed.push([...path, k]);
        delete t[k];
      } else {
        visit(s[k], t[k], [...path, k]);
      }
    }
  };
  visit(sourceRoot, targetRoot, []);
  return removed;
}

function needsTranslation(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (value.length === 0) return true;
  if (value.trim().length === 0) return true;
  return false;
}

function makeTargetSetter(targetRoot: JsonValue, path: (string | number)[]): (next: string) => void {
  return (next: string) => {
    if (path.length === 0) {
      throw new Error("Cannot set root value via sync setter");
    }
    let cur: JsonValue = targetRoot;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      const nextSeg = path[i + 1];
      if (typeof seg === "string") {
        const obj = cur as { [k: string]: JsonValue };
        if (obj[seg] === undefined || obj[seg] === null || typeof obj[seg] !== "object") {
          obj[seg] = typeof nextSeg === "number" ? [] : {};
        }
        cur = obj[seg];
      } else {
        const arr = cur as JsonValue[];
        if (arr[seg] === undefined || arr[seg] === null || typeof arr[seg] !== "object") {
          arr[seg] = typeof nextSeg === "number" ? [] : {};
        }
        cur = arr[seg];
      }
    }
    const last = path[path.length - 1];
    if (typeof last === "string") {
      (cur as { [k: string]: JsonValue })[last] = next;
    } else {
      (cur as JsonValue[])[last] = next;
    }
  };
}

export function makeEmptyTargetLike(sourceRoot: JsonValue): JsonValue {
  if (sourceRoot === null || typeof sourceRoot !== "object") return sourceRoot;
  if (Array.isArray(sourceRoot)) {
    return sourceRoot.map((v) => (typeof v === "string" ? "" : makeEmptyTargetLike(v)));
  }
  const out: { [k: string]: JsonValue } = {};
  for (const [k, v] of Object.entries(sourceRoot)) {
    out[k] = typeof v === "string" ? "" : makeEmptyTargetLike(v);
  }
  return out;
}
