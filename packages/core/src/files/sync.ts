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
