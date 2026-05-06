/**
 * Sync-mode diff: given a parsed source tree and an existing target tree,
 * compute the list of paths that need translation.
 *
 * Default rule: translate when target value is missing, an empty string, null,
 * or whitespace-only. With `--force`, translate every leaf.
 */

import { walkLeaves, getAtPath, type JsonValue } from "./walk";

export type SyncMode = "missing-only" | "force";

export type PendingTranslation = {
  path: (string | number)[];
  source: string;
  set: (next: string) => void;
};

export function diffForSync(
  sourceRoot: JsonValue,
  targetRoot: JsonValue,
  mode: SyncMode,
): PendingTranslation[] {
  const out: PendingTranslation[] = [];

  for (const leaf of walkLeaves(sourceRoot)) {
    if (mode === "force") {
      out.push({ path: leaf.path, source: leaf.value, set: makeTargetSetter(targetRoot, leaf.path) });
      continue;
    }

    const existing = getAtPath(targetRoot, leaf.path);
    if (needsTranslation(existing)) {
      out.push({ path: leaf.path, source: leaf.value, set: makeTargetSetter(targetRoot, leaf.path) });
    }
  }

  return out;
}

function needsTranslation(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (value === null) return true;
  if (typeof value !== "string") return false; // non-string existing values are preserved
  if (value.length === 0) return true;
  if (value.trim().length === 0) return true;
  return false;
}

/**
 * Build a setter that writes to the target tree at `path`, materializing
 * intermediate containers as needed (objects for string keys, arrays for numeric).
 */
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

/**
 * Build an empty target tree shaped like the source — used when no existing
 * target file exists. Mirrors structure (objects/arrays) but leaves all string
 * leaves empty so the diff sees them as missing.
 */
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
