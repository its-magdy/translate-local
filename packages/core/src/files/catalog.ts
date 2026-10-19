// The seam between translateFile and the catalog formats (JSON, YAML). A format
// parses text into a source catalog; retargeting it to one target locale gives
// the target catalog that translateFile fills in and serializes. Formats do no
// file IO: translateFile reads the files and writes the result atomically.
//
// The data side (re-rooting, plural regeneration, the output data, reverting a
// leaf an abort never reached) is shared here. A format only adds what its own
// write-back needs through FormatHooks: YAML writes the target data onto the
// source document, so that document is renamed, regenerated and pruned with it.

import type { JsonValue } from "./walk";
import { getAtPath } from "./walk";
import type { DuplicateKey } from "./json";
import type { RootLocaleRename } from "./locale-root";
import { regenerateI18nextPlurals, type PluralRegenResult } from "./i18next";
import { makeEmptyTargetLike } from "./sync";

export type Path = (string | number)[];

export interface CatalogFormat {
  /** Parses a source catalog. */
  open(text: string): SourceCatalog;
  /** Parses a catalog's data only: an existing target, or a written file before its rename. */
  read(text: string): JsonValue;
}

export type Retarget = {
  /** rebaseLocaleRoot()'s result: the source re-rooted under the target locale key. */
  localeRoot?: { source: JsonValue; rename: RootLocaleRename } | null;
  /** Set for i18next catalogs: each plural group is rewritten to the target locale's categories. */
  plurals?: { sourceLang: string; targetLang: string };
  /** The existing target's data, when the file exists. */
  existing?: JsonValue;
};

export interface SourceCatalog {
  readonly data: JsonValue;
  readonly duplicateKeys: readonly DuplicateKey[];
  /** The target catalog for one target locale. Once per source catalog. */
  retarget(r: Retarget): TargetCatalog;
}

export interface TargetCatalog {
  /** The source as the target sees it (re-rooted, plurals regenerated): what sync, prune and the lock read. */
  readonly source: JsonValue;
  readonly plurals?: PluralRegenResult;
  /** The data to write: the existing target, or an empty copy of the source's shape. Sync setters and prune change it in place. */
  readonly output: JsonValue;
  /** A leaf an abort never reached keeps the existing target's value, or is absent: never source text. */
  revertLeaf(path: Path): void;
  serialize(): string;
}

/** What a format does to its own write-back state alongside the shared data side. */
export type FormatHooks = {
  retarget?(r: Retarget): void;
  /** Called by revertLeaf with the output's value at `path`, before the data side is reverted. */
  revertLeaf?(path: Path, existing: JsonValue | undefined): void;
  serialize(output: JsonValue): string;
};

export function sourceCatalog(data: JsonValue, duplicateKeys: readonly DuplicateKey[], hooks: FormatHooks): SourceCatalog {
  let retargeted = false;
  return {
    data,
    duplicateKeys,
    retarget(r) {
      if (retargeted) throw new Error("A source catalog can be retargeted only once");
      retargeted = true;
      hooks.retarget?.(r);
      let source = r.localeRoot?.source ?? data;
      let plurals: PluralRegenResult | undefined;
      if (r.plurals) {
        plurals = regenerateI18nextPlurals(source, r.plurals.sourceLang, r.plurals.targetLang);
        source = plurals.data;
      }
      const hadExisting = r.existing !== undefined;
      const output = r.existing ?? makeEmptyTargetLike(source);
      return {
        source,
        plurals,
        output,
        revertLeaf(path) {
          // A key the target file lacks stays absent, so the app falls back to its
          // default locale ("" would render blank); one it has keeps its value.
          const existing = hadExisting ? getAtPath(output, path) : undefined;
          hooks.revertLeaf?.(path, existing);
          if (existing === undefined) deletePath(output, path);
        },
        serialize: () => hooks.serialize(output),
      };
    },
  };
}

function isMap(v: JsonValue): v is { [k: string]: JsonValue } {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Removes the value at `path`, then any map or array left empty above it.
function deletePath(root: JsonValue, path: Path): void {
  for (let n = path.length; n > 0; n--) {
    const parent = getAtPath(root, path.slice(0, n - 1));
    const seg = path[n - 1];
    if (Array.isArray(parent) && typeof seg === "number" && seg < parent.length) {
      parent.splice(seg, 1);
    } else if (parent !== undefined && isMap(parent) && typeof seg === "string" && seg in parent) {
      delete parent[seg];
    } else {
      return;
    }
    if ((Array.isArray(parent) ? parent.length : Object.keys(parent).length) > 0) return;
  }
}
