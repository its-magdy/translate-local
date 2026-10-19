import { writeFileSync, renameSync, unlinkSync } from "fs";
import { dirname, basename, join } from "path";

// Write to a sibling .tmp then rename: a crash mid-write leaves the original intact.
// If `validate` is provided, it runs against the tmp path BEFORE the rename — a throw
// aborts the commit so a malformed serialization never replaces an existing target.
export function atomicWriteFile(
  path: string,
  text: string,
  validate?: (tmpPath: string) => void,
): void {
  const dir = dirname(path);
  const tmpPath = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmpPath, text, "utf8");
    if (validate) validate(tmpPath);
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}
