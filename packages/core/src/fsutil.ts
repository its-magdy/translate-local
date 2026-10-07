import { mkdirSync, chmodSync } from "fs";
import { dirname } from "path";

/** Create a file's parent directory with owner-only permissions. */
export function ensurePrivateDir(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* may fail on system dirs like /tmp */ }
}
