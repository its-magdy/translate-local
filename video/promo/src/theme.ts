export const FPS = 30;

export const PALETTE = {
  bg: "#0b0d10",
  bgElevated: "#11151a",
  surface: "#161b22",
  border: "#262d36",
  text: "#e6edf3",
  textDim: "#8b949e",
  textMuted: "#6e7681",
  accent: "#7fb3ff",
  accentSoft: "#3a5a8c",
  highlight: "#a3d977",
  highlightSoft: "#3d5a26",
  danger: "#f47174",
  warning: "#e3b341",
} as const;

export const FONTS = {
  ui: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  ar: "'Noto Sans Arabic', 'IBM Plex Sans Arabic', system-ui, sans-serif",
} as const;

export const SCENE_FRAMES = {
  HOOK: { start: 0, duration: 6 * FPS },
  COLD_OPEN: { start: 6 * FPS, duration: 8 * FPS },
  GLOSSARY: { start: 14 * FPS, duration: 12 * FPS },
  FILE_MODE: { start: 26 * FPS, duration: 16 * FPS },
  MONTAGE: { start: 42 * FPS, duration: 12 * FPS },
  CTA: { start: 54 * FPS, duration: 6 * FPS },
} as const;

export const TOTAL_FRAMES = 60 * FPS;
