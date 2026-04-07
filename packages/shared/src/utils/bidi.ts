// BiDi reshape pipeline for shaping-blind terminals.
//
// Most popular dev terminals (Ghostty, kitty, Alacritty, WezTerm default,
// Windows Terminal, VS Code) cannot perform Arabic joining or UAX#9 BiDi
// reordering. For those sinks we pre-process Arabic text into Presentation
// Forms (Unicode blocks FB50–FDFF and FE70–FEFF) in *visual* order so the
// terminal only has to copy glyphs left-to-right.
//
// IMPORTANT — only emit reshaped output to TTY sinks. Presentation Forms are
// not for general interchange (the Unicode standard says so) and emitting
// them to pipes/files corrupts copy-paste, search, and downstream BiDi-aware
// consumers. Callers MUST gate on `process.stdout.isTTY` (or equivalent) and
// fall back to logical-order UTF-8 when piping.

import bidiFactory from "bidi-js";
import arabicReshaper from "arabic-reshaper";

const bidi = bidiFactory();

/**
 * Reshape a string for display in a shaping-blind terminal.
 *
 * Operates per line: each newline-separated paragraph is reshaped + reordered
 * independently, since UAX#9 embedding levels are paragraph-scoped.
 *
 * Safe to call on non-Arabic text — `arabic-reshaper` is a no-op on
 * codepoints outside the Arabic blocks, and `bidi-js` returns the original
 * string for pure-LTR input.
 */
export function reshapeForTerminal(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const reshaped = arabicReshaper.convertArabic(line);
    const levels = bidi.getEmbeddingLevels(reshaped, "rtl");
    lines[i] = bidi.getReorderedString(reshaped, levels);
  }
  return lines.join("\n");
}
