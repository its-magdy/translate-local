/**
 * Iterative leaf-walker over JSON-shaped trees.
 *
 * Yields every string-valued leaf with a setter that mutates the original tree
 * in place. Recurses into plain objects and arrays. Preserves all non-string
 * leaves (numbers, booleans, null) untouched. Iterative to avoid stack overflow
 * on pathological deeply-nested input. Visits children in source declaration
 * order via a single stack, with each child pushed as its own frame.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Leaf = {
  /** Path from root, e.g. ["en", "buttons", "save"] or ["items", 0, "label"] */
  path: (string | number)[];
  value: string;
  set: (next: string) => void;
};

const MAX_DEPTH = 64;

type Frame = {
  node: JsonValue;
  path: (string | number)[];
  depth: number;
  setter?: (v: string) => void;
};

export function* walkLeaves(root: JsonValue): Generator<Leaf> {
  const stack: Frame[] = [{ node: root, path: [], depth: 0 }];

  while (stack.length > 0) {
    const f = stack.pop()!;

    if (f.depth > MAX_DEPTH) {
      throw new Error(`File-translate: nesting exceeds maximum depth ${MAX_DEPTH} at path ${f.path.join(".")}`);
    }

    // String leaf reachable through a container — yield it
    if (typeof f.node === "string" && f.setter) {
      yield { path: f.path, value: f.node, set: f.setter };
      continue;
    }

    // Non-container scalar without a setter, or null — skip
    if (f.node === null || typeof f.node !== "object") continue;

    // Container: push children in reverse source order so pop visits them forward
    if (Array.isArray(f.node)) {
      const arr = f.node;
      for (let i = arr.length - 1; i >= 0; i--) {
        const idx = i;
        stack.push({
          node: arr[idx],
          path: [...f.path, idx],
          depth: f.depth + 1,
          setter: (v: string) => {
            arr[idx] = v;
          },
        });
      }
    } else {
      const obj = f.node as { [k: string]: JsonValue };
      const keys = Object.keys(obj);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        stack.push({
          node: obj[key],
          path: [...f.path, key],
          depth: f.depth + 1,
          setter: (v: string) => {
            obj[key] = v;
          },
        });
      }
    }
  }
}

/**
 * Get a value at a structured path. Returns undefined if any segment is missing
 * or traverses through a scalar.
 */
export function getAtPath(root: JsonValue, path: (string | number)[]): JsonValue | undefined {
  let cur: JsonValue = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      if (typeof seg !== "number") return undefined;
      cur = cur[seg];
    } else {
      if (typeof seg !== "string") return undefined;
      cur = (cur as { [k: string]: JsonValue })[seg];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}
