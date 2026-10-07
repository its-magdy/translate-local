// Rails-style catalogs wrap every key in a root named after the locale
// (`en:` in config/locales/en.yml), and Rails reads the locale from that key,
// not from the filename. Writing fr.yml with root `en:` would load the French
// strings as English. These helpers detect such a root and rename it to the
// target locale.

import { Document, isMap, isScalar, Scalar } from "yaml";
import { TlError } from "@translate-local/shared/errors";
import type { JsonValue } from "./walk";

export type RootLocaleRename = { from: string; to: string };

type JsonObject = { [k: string]: JsonValue };

// Rails uses `en`, `pt-BR`, and sometimes `en_US`: compare case-insensitively
// and treat `-` and `_` as the same.
function sameLocale(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "-");
  return norm(a) === norm(b);
}

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findLocaleKey(obj: JsonObject, locale: string): string | undefined {
  return Object.keys(obj).find((k) => sameLocale(k, locale));
}

/**
 * Conservative: the source root must be a mapping with exactly one key, that
 * key must equal the source locale, and its value must be a mapping. A vanilla
 * `{ app: {...} }` catalog never matches.
 *
 * Returns the source re-rooted under the target key (for diffing against the
 * target) plus the rename to apply to the written document, or null when the
 * source is not locale-rooted.
 */
export function rebaseLocaleRoot(
  source: JsonValue,
  existingTarget: JsonValue | undefined,
  sourceLocale: string | undefined,
  targetLocale: string,
): { source: JsonValue; rename: RootLocaleRename } | null {
  if (!sourceLocale || !isObject(source)) return null;
  const keys = Object.keys(source);
  if (keys.length !== 1 || !sameLocale(keys[0], sourceLocale) || !isObject(source[keys[0]])) return null;
  const from = keys[0];

  // Keep the existing target's spelling (fr_FR vs fr-FR) so a sync never adds a
  // second root next to the one already there.
  let to = targetLocale;
  if (isObject(existingTarget)) {
    const existing = findLocaleKey(existingTarget, targetLocale);
    if (existing !== undefined) {
      to = existing;
    } else if (findLocaleKey(existingTarget, from) !== undefined) {
      // Most likely output of an earlier run that kept the source root. Merging
      // would leave both `en:` and `fr:` in the file, so refuse.
      throw new TlError(
        "FILE_INVALID_FORMAT",
        `Existing target has root locale key "${findLocaleKey(existingTarget, from)}" (the source locale), expected "${targetLocale}"`,
        `If the file holds ${targetLocale} translations, rename its root key to "${targetLocale}:" and re-run; otherwise delete it.`,
      );
    }
  }

  return { source: { [to]: source[from] }, rename: { from, to } };
}

/** Rename the root pair's key in place so its comments and styles survive. */
export function renameYamlRootKey(doc: Document.Parsed, rename: RootLocaleRename): void {
  if (!isMap(doc.contents)) return;
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && String((pair.key as Scalar).value) === rename.from) {
      (pair.key as Scalar).value = rename.to;
      return;
    }
  }
}
