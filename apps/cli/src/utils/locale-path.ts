import { dirname, basename, join, extname } from "path";
import { isSupported } from "@translate-local/shared/utils/language";

const BCP47_SHAPE = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/;

export function inferOutputPath(sourcePath: string, sourceLang: string, targetLang: string): string | null {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const auto = sourceLang === "auto";
  const matches = (token: string) => {
    const lower = token.toLowerCase();
    if (!BCP47_SHAPE.test(lower)) return false;
    return auto ? isSupported(lower) : lower === sourceLang.toLowerCase();
  };

  if (matches(stem)) {
    return join(dir, `${targetLang}${ext}`);
  }

  const dotIdx = stem.lastIndexOf(".");
  if (dotIdx > 0 && matches(stem.slice(dotIdx + 1))) {
    return join(dir, `${stem.slice(0, dotIdx)}.${targetLang}${ext}`);
  }

  if (matches(basename(dir))) {
    return join(dirname(dir), targetLang, base);
  }

  return null;
}
