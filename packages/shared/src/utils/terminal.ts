// Terminal BiDi capability detection.
//
// The freedesktop terminal-wg recommends emitting Arabic in logical order and
// letting the terminal handle shaping + UAX#9 reordering, but in practice only
// a minority of emulators do that correctly. The matrix as of 2025–2026:
//
//   Logical-order capable (emit raw):
//     - GNOME Terminal / VTE  (VTE_VERSION env var)
//     - Konsole               (KONSOLE_VERSION env var)
//     - mlterm                (TERM=mlterm*)
//     - iTerm2 ≥ 3.6 with experimental RTL flag (LC_TERMINAL=iTerm2; we
//       optimistically trust the user has the flag on — they can override
//       with --bidi=reshape)
//
//   Shaping-blind (need pre-shaped Presentation Forms in visual order):
//     - Ghostty (stable)
//     - kitty
//     - Alacritty
//     - WezTerm (default)
//     - Windows Terminal
//     - VS Code integrated terminal
//     - Anything routed through tmux (tmux #2425 corrupts pane geometry on
//       logical-order RTL regardless of host)

export type BidiCapability = "logical" | "reshape";

export interface BidiCapabilityEnv {
  VTE_VERSION?: string;
  KONSOLE_VERSION?: string;
  TERM?: string;
  LC_TERMINAL?: string;
  TMUX?: string;
}

export function detectTerminalBidiCapability(
  env: BidiCapabilityEnv = process.env as BidiCapabilityEnv,
): BidiCapability {
  // tmux mangles RTL pane geometry no matter what the host does.
  if (env.TMUX) return "reshape";

  if (env.VTE_VERSION) return "logical";
  if (env.KONSOLE_VERSION) return "logical";
  if (env.TERM && /^mlterm/i.test(env.TERM)) return "logical";
  if (env.LC_TERMINAL === "iTerm2") return "logical";

  return "reshape";
}
