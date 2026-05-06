/**
 * Output path inference for `tl translate --file`.
 *
 * Replaces a locale token in the source filename with the target locale.
 * Recognizes three layouts:
 *   - <dir>/<lang>.<ext>          (e.g. en.json -> ar.json)
 *   - <dir>/<file>.<lang>.<ext>   (e.g. messages.en.yaml -> messages.ar.yaml)
 *   - <dir>/<lang>/<file>         (e.g. locales/en/common.json -> locales/ar/common.json)
 *
 * When `sourceLang` is "auto", we scan for any BCP-47-shaped token (lowercase
 * 2-3 letters, optionally followed by -REGION) in the filename. If multiple
 * candidates exist, the most-specific layout wins (file.<lang>.<ext> over
 * <lang>.<ext> over dir-based).
 *
 * Returns null when no locale token can be confidently identified.
 */

import { dirname, basename, join, extname } from "path";

const BCP47 = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

export function inferOutputPath(sourcePath: string, sourceLang: string, targetLang: string): string | null {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const auto = sourceLang === "auto";

  // Layout 1: <lang>.<ext> — entire stem is the locale code
  if (auto ? BCP47.test(stem) : stem === sourceLang) {
    return join(dir, `${targetLang}${ext}`);
  }

  // Layout 2: <file>.<lang>.<ext> — locale is the part before the extension
  const dotIdx = stem.lastIndexOf(".");
  if (dotIdx > 0) {
    const tail = stem.slice(dotIdx + 1);
    if (auto ? BCP47.test(tail) : tail === sourceLang) {
      return join(dir, `${stem.slice(0, dotIdx)}.${targetLang}${ext}`);
    }
  }

  // Layout 3: dir-based <parent>/<lang>/<file> — replace the parent dir
  const parentDir = basename(dir);
  if (auto ? BCP47.test(parentDir) : parentDir === sourceLang) {
    return join(dirname(dir), targetLang, base);
  }

  return null;
}
