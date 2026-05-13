import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily } from "../fonts";
import {
  BlinkCursor,
  Prompt,
  TerminalWindow,
  typeSlice,
} from "../components/Terminal";
import {
  MacTerminalChrome,
  TlTuiTranslate,
  TlTuiGlossary,
  GlossaryRow,
} from "../components/TlTui";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 0.7, 0);

const IMAGE_HOLD_END = 150;
const IMAGE_FADE_OUT_FRAMES = 12;
const TUI_START = IMAGE_HOLD_END + IMAGE_FADE_OUT_FRAMES;
const TUI_TYPE_START = TUI_START + 30;
const TUI_TYPE_TEXT = "Welcome back to your account";
const TUI_TYPE_CHAR_FRAMES = 1.4;
const TUI_TYPE_END =
  TUI_TYPE_START + Math.ceil(TUI_TYPE_TEXT.length * TUI_TYPE_CHAR_FRAMES);
const TUI_STREAM_START = TUI_TYPE_END + 10;
const TUI_AR_TEXT = "مرحبًا بعودتك إلى حسابك";
const TUI_STREAM_CHAR_FRAMES = 1.8;
const TUI_STREAM_END =
  TUI_STREAM_START +
  Math.ceil(TUI_AR_TEXT.length * TUI_STREAM_CHAR_FRAMES);
const TAB_SWITCH = TUI_STREAM_END + 55;

const MenuPhoto: React.FC = () => {
  return (
    <div
      style={{
        position: "relative",
        transform: "rotate(-4deg)",
        filter: "drop-shadow(0 32px 60px rgba(0,0,0,0.7))",
      }}
    >
      <div
        style={{
          width: 560,
          background: "#f7f3ea",
          padding: "22px 22px 80px 22px",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            height: 660,
            background:
              "linear-gradient(140deg, #2b2114 0%, #3d2f1e 40%, #1f1810 100%)",
            position: "relative",
            overflow: "hidden",
            padding: "54px 44px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at 30% 20%, rgba(255,220,160,0.12) 0%, transparent 55%), radial-gradient(ellipse at 80% 90%, rgba(0,0,0,0.45) 0%, transparent 60%)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, rgba(0,0,0,0.015) 0px, rgba(0,0,0,0.015) 1px, transparent 1px, transparent 3px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              fontFamily: interFamily,
              fontSize: 42,
              fontWeight: 800,
              color: "#f4e1b8",
              letterSpacing: -0.5,
              textAlign: "center",
              marginBottom: 22,
              textShadow: "0 2px 6px rgba(0,0,0,0.4)",
              position: "relative",
            }}
          >
            EL MESÓN
          </div>
          <div
            style={{
              height: 1,
              background: "#7a5a2e",
              marginBottom: 14,
              position: "relative",
            }}
          />
          {[
            ["Gazpacho andaluz", "8 €"],
            ["Tortilla española", "10 €"],
            ["Paella valenciana", "18 €"],
            ["Pulpo a la gallega", "16 €"],
            ["Crema catalana", "7 €"],
          ].map(([dish, price], i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: interFamily,
                fontSize: 22,
                color: "#e9d6a8",
                position: "relative",
              }}
            >
              <span>{dish}</span>
              <span style={{ opacity: 0.7 }}>{price}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 18,
            textAlign: "center",
            fontFamily: monoFamily,
            fontSize: 16,
            color: "#7a7167",
            letterSpacing: 0.3,
          }}
        >
          IMG_2421.jpg · 13 May · 4032×3024 · 1.4 MB
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: -22,
          left: -16,
          fontFamily: interFamily,
          fontSize: 14,
          fontWeight: 700,
          color: "#0b0d10",
          background: "#f4e1b8",
          padding: "5px 14px",
          borderRadius: 999,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          transform: "rotate(-3deg)",
        }}
      >
        <span style={{ marginRight: 6 }}>📷</span>
        Your photo
      </div>
    </div>
  );
};

const OUTPUT_LINES = [
  "Andalusian gazpacho",
  "Spanish omelette",
  "Valencian paella",
  "Galician octopus",
  "Catalan custard",
];

const IMAGE_CMD = "tl translate --image IMG_2421.jpg --to en";
const IMG_TERMINAL_IN = 8;
const IMG_CMD_START = 20;
const IMG_CMD_CHAR_FRAMES = 0.9;
const IMG_CMD_END =
  IMG_CMD_START + Math.ceil(IMAGE_CMD.length * IMG_CMD_CHAR_FRAMES);
const IMG_OUTPUT_START = IMG_CMD_END + 10;
const IMG_LINE_FRAMES = 6;
const IMG_OUTPUT_END = IMG_OUTPUT_START + OUTPUT_LINES.length * IMG_LINE_FRAMES;
const IMG_FOOTER_AT = IMG_OUTPUT_END + 4;

const ImageMode: React.FC<{ frame: number; opacity: number }> = ({
  frame,
  opacity,
}) => {
  const cmdTyped = typeSlice({
    frame,
    text: IMAGE_CMD,
    start: IMG_CMD_START,
    charFrames: IMG_CMD_CHAR_FRAMES,
  });
  const terminalOpacity = interpolate(
    frame,
    [IMG_TERMINAL_IN, IMG_TERMINAL_IN + 14],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const terminalX = interpolate(
    frame,
    [IMG_TERMINAL_IN, IMG_TERMINAL_IN + 14],
    [40, 0],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const labelOpacity = interpolate(frame, [6, 22], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const linesVisible = Math.max(
    0,
    Math.min(
      OUTPUT_LINES.length,
      Math.floor((frame - IMG_OUTPUT_START) / IMG_LINE_FRAMES),
    ),
  );

  const showThinking =
    frame >= IMG_CMD_END + 2 && frame < IMG_OUTPUT_START;
  const dotCount = Math.floor((frame - IMG_CMD_END - 2) / 4) % 4;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
        <MenuPhoto />
        <div
          style={{
            opacity: terminalOpacity,
            transform: `translateX(${terminalX}px)`,
          }}
        >
          <TerminalWindow width={780} height={620} title="~ — tl translate">
            <div style={{ fontSize: 22, marginBottom: 18 }}>
              <Prompt>
                <span style={{ color: PALETTE.text }}>{cmdTyped}</span>
                {frame < IMG_CMD_END ? <BlinkCursor frame={frame} /> : null}
              </Prompt>
            </div>
            {showThinking ? (
              <div
                style={{
                  fontFamily: monoFamily,
                  fontSize: 18,
                  color: PALETTE.textMuted,
                  marginBottom: 12,
                }}
              >
                analyzing image{".".repeat(dotCount)}
              </div>
            ) : null}
            <div
              style={{
                fontFamily: monoFamily,
                fontSize: 26,
                color: PALETTE.text,
                lineHeight: 1.55,
                minHeight: 260,
              }}
            >
              {OUTPUT_LINES.slice(0, linesVisible).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
            <div
              style={{
                marginTop: 22,
                fontFamily: monoFamily,
                fontSize: 16,
                color: PALETTE.textMuted,
                opacity: frame >= IMG_FOOTER_AT ? 1 : 0,
              }}
            >
              <div>↳ translate-gemma-local · 10.4s</div>
              <div style={{ color: PALETTE.highlight, marginTop: 4 }}>
                ✓ Glossary: 100% covered
              </div>
            </div>
          </TerminalWindow>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 60,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: interFamily,
          fontSize: 28,
          fontWeight: 600,
          color: PALETTE.text,
          letterSpacing: 0.3,
          opacity: labelOpacity,
        }}
      >
        <span style={{ color: PALETTE.accent }}>━━━━━</span>{" "}
        Translate from a photo{" "}
        <span style={{ color: PALETTE.accent }}>━━━━━</span>
      </div>
    </AbsoluteFill>
  );
};

const GLOSSARY_ROWS: GlossaryRow[] = [
  {
    id: "8288d756",
    source: "machine learning",
    translation: "تعلم الآلة",
    pair: "[en→ar]",
  },
  {
    id: "af586251",
    source: "neural network",
    translation: "شبكة عصبية",
    pair: "[en→ar]",
  },
  {
    id: "e00290ea",
    source: "login",
    translation: "تسجيل الدخول",
    pair: "[en→ar]",
  },
  {
    id: "3c2b9c3b",
    source: "signup",
    translation: "التسجيل",
    pair: "[en→ar]",
  },
  {
    id: "79912c12",
    source: "dashboard",
    translation: "لوحة التحكم",
    pair: "[en→ar]",
  },
];

const TuiMode: React.FC<{ frame: number; opacity: number }> = ({
  frame,
  opacity,
}) => {
  const typed = typeSlice({
    frame,
    text: TUI_TYPE_TEXT,
    start: TUI_TYPE_START,
    charFrames: TUI_TYPE_CHAR_FRAMES,
  });
  const arabicTyped = typeSlice({
    frame,
    text: TUI_AR_TEXT,
    start: TUI_STREAM_START,
    charFrames: TUI_STREAM_CHAR_FRAMES,
  });
  const tabSwitched = frame >= TAB_SWITCH;
  const caretOn = frame % 16 < 8;

  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity }}
    >
      <MacTerminalChrome width={1500} height={820}>
        {tabSwitched ? (
          <TlTuiGlossary rows={GLOSSARY_ROWS} highlightIndex={0} />
        ) : (
          <TlTuiTranslate
            sourceText={typed}
            targetText={arabicTyped}
            showSourceCaret={frame < TUI_TYPE_END}
            caretOn={caretOn}
          />
        )}
      </MacTerminalChrome>
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: interFamily,
          fontSize: 28,
          fontWeight: 600,
          color: PALETTE.text,
          letterSpacing: 0.3,
        }}
      >
        <span style={{ color: PALETTE.accent }}>━━━━━</span> Or use the TUI{" "}
        <span style={{ color: PALETTE.accent }}>━━━━━</span>
      </div>
    </AbsoluteFill>
  );
};

export const SceneMontage: React.FC = () => {
  const frame = useCurrentFrame();
  const imageOpacity =
    interpolate(frame, [0, 10], [0, 1], {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) -
    interpolate(
      frame,
      [IMAGE_HOLD_END, IMAGE_HOLD_END + IMAGE_FADE_OUT_FRAMES],
      [0, 1],
      {
        easing: EASE_IN,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    );

  const tuiOpacity = interpolate(
    frame,
    [TUI_START, TUI_START + 18],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bg }}>
      {frame < TUI_START ? (
        <ImageMode frame={frame} opacity={imageOpacity} />
      ) : (
        <TuiMode frame={frame} opacity={tuiOpacity} />
      )}
    </AbsoluteFill>
  );
};
