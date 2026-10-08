import { dirname, basename, join, extname } from "path";
import { isSupported } from "@translate-local/shared/utils/language";

const BCP47_SHAPE = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/;

type TokenMatch = { token: string; layout: "stem" | "suffix" | "dir" };

function findLocaleToken(sourcePath: string, sourceLang: string): TokenMatch | null {
  const dir = dirname(sourcePath);
  const base = basename(sourcePath);
  const stem = base.slice(0, base.length - extname(base).length);
  const auto = sourceLang === "auto";
  const matches = (token: string) => {
    const lower = token.toLowerCase();
    if (!BCP47_SHAPE.test(lower)) return false;
    return auto ? isSupported(lower) : lower === sourceLang.toLowerCase();
  };

  if (matches(stem)) return { token: stem, layout: "stem" };

  const dotIdx = stem.lastIndexOf(".");
  if (dotIdx > 0 && matches(stem.slice(dotIdx + 1))) return { token: stem.slice(dotIdx + 1), layout: "suffix" };

  if (matches(basename(dir))) return { token: basename(dir), layout: "dir" };

  return null;
}

export function inferOutputPath(sourcePath: string, sourceLang: string, targetLang: string): string | null {
  const m = findLocaleToken(sourcePath, sourceLang);
  if (!m) return null;
  const dir = dirname(sourcePath);
  const base = basename(sourcePath);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  switch (m.layout) {
    case "stem":
      return join(dir, `${targetLang}${ext}`);
    case "suffix":
      return join(dir, `${stem.slice(0, stem.length - m.token.length)}${targetLang}${ext}`);
    case "dir":
      return join(dirname(dir), targetLang, base);
  }
}

/** The locale token in the source filename (e.g. "en" in config/locales/en.yml), if any. */
export function inferSourceLocale(sourcePath: string, sourceLang: string): string | null {
  return findLocaleToken(sourcePath, sourceLang)?.token ?? null;
}
