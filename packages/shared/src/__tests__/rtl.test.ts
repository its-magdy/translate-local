import { describe, expect, it } from "bun:test";
import { isRtlLang, RTL_LANGS } from "../constants";
import { detectTerminalBidiCapability } from "../utils/terminal";
import { reshapeForTerminal } from "../utils/bidi";

describe("isRtlLang", () => {
  it("returns true for RTL primary subtags", () => {
    for (const lang of ["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]) {
      expect(isRtlLang(lang)).toBe(true);
    }
  });

  it("returns true for RTL with region/script subtags", () => {
    expect(isRtlLang("ar-EG")).toBe(true);
    expect(isRtlLang("AR-eg")).toBe(true);
    expect(isRtlLang("he-IL")).toBe(true);
  });

  it("returns false for LTR languages", () => {
    for (const lang of ["en", "en-US", "fr", "de", "ja", "zh", "zh-tw", "ko", "ru"]) {
      expect(isRtlLang(lang)).toBe(false);
    }
  });

  it("returns false for nullish input", () => {
    expect(isRtlLang(undefined)).toBe(false);
    expect(isRtlLang(null)).toBe(false);
    expect(isRtlLang("")).toBe(false);
  });

  it("RTL_LANGS set contains all expected codes", () => {
    expect(RTL_LANGS.has("ar")).toBe(true);
    expect(RTL_LANGS.has("en")).toBe(false);
  });
});

describe("detectTerminalBidiCapability", () => {
  it("returns 'logical' for VTE-based terminals", () => {
    expect(detectTerminalBidiCapability({ VTE_VERSION: "7600" })).toBe("logical");
  });

  it("returns 'logical' for Konsole", () => {
    expect(detectTerminalBidiCapability({ KONSOLE_VERSION: "230400" })).toBe("logical");
  });

  it("returns 'logical' for mlterm", () => {
    expect(detectTerminalBidiCapability({ TERM: "mlterm" })).toBe("logical");
    expect(detectTerminalBidiCapability({ TERM: "mlterm-256color" })).toBe("logical");
  });

  it("returns 'logical' for iTerm2", () => {
    expect(detectTerminalBidiCapability({ LC_TERMINAL: "iTerm2" })).toBe("logical");
  });

  it("returns 'reshape' for Ghostty / kitty / Alacritty / WezTerm / unknown", () => {
    expect(detectTerminalBidiCapability({ TERM: "xterm-ghostty" })).toBe("reshape");
    expect(detectTerminalBidiCapability({ TERM: "xterm-kitty" })).toBe("reshape");
    expect(detectTerminalBidiCapability({ TERM: "alacritty" })).toBe("reshape");
    expect(detectTerminalBidiCapability({ TERM: "wezterm" })).toBe("reshape");
    expect(detectTerminalBidiCapability({})).toBe("reshape");
  });

  it("returns 'reshape' inside tmux even when host is BiDi-capable", () => {
    // tmux #2425 corrupts pane geometry on logical-order RTL.
    expect(detectTerminalBidiCapability({ TMUX: "/tmp/tmux", VTE_VERSION: "7600" })).toBe("reshape");
    expect(detectTerminalBidiCapability({ TMUX: "/tmp/tmux", LC_TERMINAL: "iTerm2" })).toBe("reshape");
  });
});

describe("reshapeForTerminal", () => {
  it("is a no-op on empty input", () => {
    expect(reshapeForTerminal("")).toBe("");
  });

  it("is a no-op on pure ASCII / LTR text", () => {
    expect(reshapeForTerminal("hello world")).toBe("hello world");
  });

  it("converts logical-order Arabic to visual-order Presentation Forms", () => {
    const out = reshapeForTerminal("مرحبا بالعالم");
    // Every codepoint must lie in the Arabic Presentation Forms blocks
    // (FB50–FDFF or FE70–FEFF) or be ASCII whitespace.
    for (const ch of out) {
      const cp = ch.codePointAt(0)!;
      const inFormsA = cp >= 0xfb50 && cp <= 0xfdff;
      const inFormsB = cp >= 0xfe70 && cp <= 0xfeff;
      const isSpace = cp === 0x20;
      expect(inFormsA || inFormsB || isSpace).toBe(true);
    }
    // The first visual codepoint corresponds to the LAST logical letter (م
    // → final form ﻢ, U+FEE2), confirming both reshape AND reorder happened.
    expect(out.codePointAt(0)).toBe(0xfee2);
  });

  it("processes each line independently", () => {
    const out = reshapeForTerminal("hello\nمرحبا");
    const [line1, line2] = out.split("\n");
    expect(line1).toBe("hello");
    // line2 should be reshaped + reordered
    expect(line2).not.toBe("مرحبا");
    expect(line2!.codePointAt(0)).toBeGreaterThanOrEqual(0xfb50);
  });
});
