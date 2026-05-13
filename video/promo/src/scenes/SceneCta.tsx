import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily } from "../fonts";
import { typeSlice } from "../components/Terminal";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const INSTALL = "brew install its-magdy/tap/tl";
const LOGO_START = 6;
const INSTALL_TYPE_START = 22;
const INSTALL_CHAR_FRAMES = 1.5;
const INSTALL_TYPE_END =
  INSTALL_TYPE_START + Math.ceil(INSTALL.length * INSTALL_CHAR_FRAMES);
const URL_START = INSTALL_TYPE_END + 6;

export const SceneCta: React.FC = () => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(
    frame,
    [LOGO_START, LOGO_START + 16],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const logoY = interpolate(frame, [LOGO_START, LOGO_START + 16], [16, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const logoScale = interpolate(
    frame,
    [LOGO_START, LOGO_START + 18],
    [0.96, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const installTyped = typeSlice({
    frame,
    text: INSTALL,
    start: INSTALL_TYPE_START,
    charFrames: INSTALL_CHAR_FRAMES,
  });

  const installCardOpacity = interpolate(
    frame,
    [INSTALL_TYPE_START - 6, INSTALL_TYPE_START + 8],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const installCardY = interpolate(
    frame,
    [INSTALL_TYPE_START - 6, INSTALL_TYPE_START + 8],
    [14, 0],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const urlOpacity = interpolate(frame, [URL_START, URL_START + 14], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const urlY = interpolate(frame, [URL_START, URL_START + 14], [10, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const showCaret = frame >= INSTALL_TYPE_START && frame < INSTALL_TYPE_END + 12;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: PALETTE.bg,
        alignItems: "center",
        justifyContent: "center",
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          opacity: logoOpacity,
          transform: `translateY(${logoY}px) scale(${logoScale})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: 220,
              fontWeight: 700,
              letterSpacing: -10,
              color: PALETTE.text,
              lineHeight: 1,
            }}
          >
            tl
          </div>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: PALETTE.accent,
              transform: "translateY(-14px)",
              boxShadow: `0 0 44px ${PALETTE.accent}66`,
            }}
          />
        </div>
        <div
          style={{
            fontFamily: interFamily,
            fontSize: 32,
            fontWeight: 500,
            color: PALETTE.textDim,
            letterSpacing: 0.4,
          }}
        >
          translate locally. own your data.
        </div>
      </div>
      <div
        style={{
          opacity: installCardOpacity,
          transform: `translateY(${installCardY}px)`,
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: 12,
          padding: "22px 36px",
          fontFamily: monoFamily,
          fontSize: 38,
          color: PALETTE.text,
          letterSpacing: 0.4,
          boxShadow:
            "0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(127,179,255,0.18)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span style={{ color: PALETTE.accent }}>$</span>
        <span>{installTyped}</span>
        {showCaret ? (
          <span
            style={{
              display: "inline-block",
              width: "0.55em",
              height: "1em",
              background: PALETTE.accent,
              verticalAlign: "-0.12em",
              opacity: frame % 16 < 8 ? 1 : 0,
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          opacity: urlOpacity,
          transform: `translateY(${urlY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: monoFamily,
            fontSize: 24,
            color: PALETTE.textDim,
            letterSpacing: 0.4,
          }}
        >
          github.com/its-magdy/translate-local
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span
            style={{
              fontFamily: interFamily,
              fontSize: 14,
              fontWeight: 700,
              color: PALETTE.highlight,
              background: "rgba(163,217,119,0.12)",
              border: `1px solid rgba(163,217,119,0.4)`,
              padding: "4px 10px",
              borderRadius: 999,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            MIT
          </span>
          <span
            style={{
              fontFamily: interFamily,
              fontSize: 14,
              fontWeight: 600,
              color: PALETTE.accent,
              background: "rgba(127,179,255,0.1)",
              border: `1px solid rgba(127,179,255,0.4)`,
              padding: "4px 10px",
              borderRadius: 999,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            local-first
          </span>
        </div>
        <div
          style={{
            fontFamily: monoFamily,
            fontSize: 18,
            color: PALETTE.textMuted,
            letterSpacing: 0.3,
            marginTop: 6,
          }}
        >
          powered by Ollama + TranslateGemma
        </div>
      </div>
    </AbsoluteFill>
  );
};
