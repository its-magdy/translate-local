// Per-target lock file: records a hash of each source value the target was last
// synced from, so a later run can tell when a source string changed under an
// existing translation.
//
// Location: `<root>/.tl/locks/<target path relative to root>.lock`, where root
// is the nearest ancestor of the target containing `.git` (the project root),
// falling back to the target's own directory. Never beside the target: Hugo
// loads every non-dot file under i18n/ (recursively, no extension filter), and
// Vite / Next copy everything in public/ verbatim, so a sibling lock would
// break builds or ship as an asset. Hugo skips dot-named entries — including
// directories, before descending — so even the fallback `.tl/` is ignored.
//
// One file per target (not one shared lock): a merge conflict or corruption is
// confined to that target, the recovery ("delete this lock") only resets that
// target's baseline, and file sizes stay proportional to one catalog. Per
// target rather than per source because each run syncs one target, and targets
// of the same source are synced at different times.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "fs";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { TlError } from "@translate-local/shared/errors";
import { atomicWriteFile } from "./json";

const LOCK_VERSION = 1;
const LOCK_DIR = [".tl", "locks"];

export type Checksums = Record<string, string>;

// Real path of the target, so a symlinked target shares its lock with the file
// it points at. The target may not exist yet: then realpath its directory.
function realTarget(outPath: string): string {
  try {
    return realpathSync(outPath);
  } catch {
    try {
      return join(realpathSync(dirname(outPath)), basename(outPath));
    } catch {
      return resolve(outPath);
    }
  }
}

export function lockPathFor(outPath: string): string {
  const target = realTarget(outPath);
  let root = dirname(target);
  for (let d = root; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) {
      root = d;
      break;
    }
    if (dirname(d) === d) break;
  }
  // root is always an ancestor of target, so the relative path never has "..".
  return join(root, ...LOCK_DIR, ...relative(root, target).split(sep)) + ".lock";
}

// First 16 hex chars (64 bits) of sha256: plenty to detect a change to one
// string, and a quarter of the size of the full digest. node:crypto rather than
// Bun.hash: the lock is committed, so the digest must be identical across
// runtimes (core also ships a Node build) and versions.
export function hashSource(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

// RFC 6901 JSON Pointer. Joining with "." would collide for keys that contain
// dots ("section.title" vs section → title).
export function lockKey(path: (string | number)[]): string {
  return path.map((seg) => "/" + String(seg).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}

function corrupt(path: string, detail: string, cause?: unknown): TlError {
  return new TlError(
    "FILE_PARSE_FAILED",
    `Invalid lock file ${path}: ${detail}`,
    `Delete ${path} to rebuild it on the next run. Only this target is affected: its existing translations are kept, but source changes made since its last run will not be detected.`,
    cause,
  );
}

/** Returns null when no lock exists for this target (first run). Throws on a corrupt lock. */
export function readLock(path: string): Checksums | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw corrupt(path, err instanceof Error ? err.message : String(err), err);
  }
  const obj = parsed as { version?: unknown; checksums?: unknown };
  if (typeof obj !== "object" || obj === null || obj.version !== LOCK_VERSION) {
    throw corrupt(path, `expected "version": ${LOCK_VERSION}`);
  }
  const sums = obj.checksums;
  if (typeof sums !== "object" || sums === null || Array.isArray(sums)) {
    throw corrupt(path, `"checksums" must be an object`);
  }
  if (Object.values(sums).some((v) => typeof v !== "string")) {
    throw corrupt(path, "checksum values must be strings");
  }
  return sums as Checksums;
}

/** Sorted keys + fixed formatting so the lock diffs cleanly in git. Atomic like the target write. */
export function writeLock(path: string, checksums: Checksums): void {
  const sorted: Checksums = {};
  for (const k of Object.keys(checksums).sort()) sorted[k] = checksums[k];
  const text = JSON.stringify({ version: LOCK_VERSION, checksums: sorted }, null, 2) + "\n";
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, text, (tmp) => { readLock(tmp); });
}
