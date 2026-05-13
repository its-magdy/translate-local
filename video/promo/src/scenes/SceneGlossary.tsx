import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, arabicFamily, monoFamily } from "../fonts";
import {
  BlinkCursor,
  Prompt,
  TerminalWindow,
  typeSlice,
} from "../components/Terminal";
import { CsvViewer, CsvRow } from "../components/CsvViewer";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const ROWS: CsvRow[] = [
  {
    source: "machine learning",
    target: "تعلم الآلة",
    from: "en",
    to: "ar",
    domain: "tech",
  },
  {
    source: "neural network",
    target: "شبكة عصبية",
    from: "en",
    to: "ar",
    domain: "tech",
  },
  {
    source: "login",
    target: "تسجيل الدخول",
    from: "en",
    to: "ar",
    domain: "ui",
  },
  {
    source: "signup",
    target: "التسجيل",
    from: "en",
    to: "ar",
    domain: "ui",
  },
  {
    source: "dashboard",
    target: "لوحة التحكم",
    from: "en",
    to: "ar",
    domain: "ui",
  },
];

const HIGHLIGHT_ROW = 2;
const COMMAND = `tl "Login to your dashboard" --to ar --glossary strict`;

const PANES_IN = 16;
const HIGHLIGHT_START = 38;
const HIGHLIGHT_END = 58;
const TYPE_START = 70;
const CHAR_FRAMES = 1.3;
const TYPE_END = TYPE_START + Math.ceil(COMMAND.length * CHAR_FRAMES);
const PAUSE_END = TYPE_END + 16;
const STREAM_START = PAUSE_END;
// Tokens with metadata for highlight
const OUT_TOKENS: Array<{ text: string; glossary?: boolean }> = [
  { text: "تسجيل الدخول", glossary: true },
  { text: " " },
  { text: "إلى" },
  { text: " " },
  { text: "لوحة التحكم" },
  { text: "." },
];
const STREAM_PER = 12;
const STREAM_END = STREAM_START + OUT_TOKENS.length * STREAM_PER;
const LOCK_POP_START = STREAM_START + STREAM_PER + 4;
const CAPTION_START = STREAM_END + 8;

export const SceneGlossary: React.FC = () => {
  const frame = useCurrentFrame();

  const panesOpacity = interpolate(frame, [0, PANES_IN], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const leftX = interpolate(frame, [0, PANES_IN], [-60, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rightX = interpolate(frame, [0, PANES_IN], [60, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const highlightOpacity = interpolate(
    frame,
    [HIGHLIGHT_START, HIGHLIGHT_END],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const typed = typeSlice({
    frame,
    text: COMMAND,
    start: TYPE_START,
    charFrames: CHAR_FRAMES,
  });
  const showInputCursor = frame >= TYPE_START && frame < PAUSE_END;

  const streamedTokens = Math.max(
    0,
    Math.min(
      OUT_TOKENS.length,
      Math.floor((frame - STREAM_START) / STREAM_PER),
    ),
  );

  const lockOpacity = interpolate(
    frame,
    [LOCK_POP_START, LOCK_POP_START + 12],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const lockY = interpolate(
    frame,
    [LOCK_POP_START, LOCK_POP_START + 12],
    [10, 0],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const captionOpacity = interpolate(
    frame,
    [CAPTION_START, CAPTION_START + 14],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const captionY = interpolate(
    frame,
    [CAPTION_START, CAPTION_START + 14],
    [14, 0],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: PALETTE.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 36,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            opacity: panesOpacity,
            transform: `translateX(${leftX}px)`,
          }}
        >
          <CsvViewer
            rows={ROWS}
            width={700}
            height={520}
            highlightIndex={HIGHLIGHT_ROW}
            highlightOpacity={highlightOpacity}
          />
        </div>
        <div
          style={{
            opacity: panesOpacity,
            transform: `translateX(${rightX}px)`,
          }}
        >
          <TerminalWindow width={980} height={520} title="~ — tl glossary">
            <div style={{ marginBottom: 18, fontSize: 22 }}>
              <Prompt>
                <span style={{ color: PALETTE.text }}>{typed}</span>
                {showInputCursor ? <BlinkCursor frame={frame} /> : null}
              </Prompt>
            </div>
            <div
              style={{
                direction: "rtl",
                textAlign: "right",
                fontFamily: arabicFamily,
                fontSize: 46,
                fontWeight: 500,
                color: PALETTE.text,
                minHeight: 80,
                lineHeight: 1.4,
                position: "relative",
              }}
            >
              {OUT_TOKENS.slice(0, streamedTokens).map((t, i) => {
                if (!t.glossary) {
                  return <span key={i}>{t.text}</span>;
                }
                return (
                  <span
                    key={i}
                    style={{
                      position: "relative",
                      color: PALETTE.highlight,
                      fontWeight: 700,
                      textShadow: `0 0 24px rgba(163,217,119,0.35)`,
                    }}
                  >
                    {t.text}
                    {frame >= LOCK_POP_START ? (
                      <span
                        style={{
                          position: "absolute",
                          top: -34,
                          right: 0,
                          fontFamily: interFamily,
                          fontSize: 14,
                          color: PALETTE.highlight,
                          background: "rgba(163,217,119,0.12)",
                          border: `1px solid rgba(163,217,119,0.5)`,
                          padding: "3px 9px",
                          borderRadius: 999,
                          direction: "ltr",
                          letterSpacing: 0.3,
                          whiteSpace: "nowrap",
                          opacity: lockOpacity,
                          transform: `translateY(${lockY}px)`,
                          fontWeight: 600,
                        }}
                      >
                        🔒 from glossary
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 30,
                fontFamily: monoFamily,
                fontSize: 14,
                color: PALETTE.textMuted,
                opacity: frame >= STREAM_END ? 1 : 0,
              }}
            >
              ↳ glossary coverage: 1.00 · missing: 0 · 287 ms
            </div>
          </TerminalWindow>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 70,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: interFamily,
          fontSize: 32,
          fontWeight: 500,
          color: PALETTE.textDim,
          letterSpacing: 0.2,
          opacity: captionOpacity,
          transform: `translateY(${captionY}px)`,
        }}
      >
        Your terms. Enforced.
      </div>
    </AbsoluteFill>
  );
};
