import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily } from "../fonts";
import { typeSlice } from "../components/Terminal";
import {
  MacTerminalChrome,
  TlTuiTranslate,
  TlTuiGlossary,
  GlossaryRow,
} from "../components/TlTui";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 0.7, 0);

const IMAGE_HOLD_END = 120;
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
        width: 540,
        height: 700,
        borderRadius: 18,
        background:
          "linear-gradient(140deg, #2b2114 0%, #3d2f1e 40%, #1f1810 100%)",
        boxShadow:
          "0 30px 80px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.03) inset",
        border: `1px solid ${PALETTE.border}`,
        padding: "60px 48px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        transform: "rotate(-2.5deg)",
        position: "relative",
      }}
    >
      <div
        style={{
          fontFamily: interFamily,
          fontSize: 42,
          fontWeight: 800,
          color: "#f4e1b8",
          letterSpacing: -0.5,
          textAlign: "center",
          marginBottom: 22,
        }}
      >
        EL MESÓN
      </div>
      <div
        style={{
          height: 1,
          background: "#7a5a2e",
          marginBottom: 14,
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
          }}
        >
          <span>{dish}</span>
          <span style={{ opacity: 0.7 }}>{price}</span>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 24,
          fontFamily: monoFamily,
          fontSize: 12,
          color: PALETTE.textMuted,
          background: "rgba(0,0,0,0.4)",
          padding: "3px 8px",
          borderRadius: 4,
        }}
      >
        IMG_2421.jpg
      </div>
    </div>
  );
};

const TranslatedCard: React.FC<{ opacity: number; x: number }> = ({
  opacity,
  x,
}) => {
  return (
    <div
      style={{
        width: 480,
        background: PALETTE.surface,
        border: `1px solid ${PALETTE.border}`,
        borderRadius: 14,
        padding: "28px 30px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        opacity,
        transform: `translateX(${x}px)`,
      }}
    >
      <div
        style={{
          fontFamily: monoFamily,
          fontSize: 13,
          color: PALETTE.accent,
          letterSpacing: 1.5,
          marginBottom: 14,
          textTransform: "uppercase",
        }}
      >
        ↪ translated · es → en
      </div>
      <div
        style={{
          fontFamily: interFamily,
          fontSize: 32,
          fontWeight: 700,
          color: PALETTE.text,
          marginBottom: 16,
          letterSpacing: -0.4,
        }}
      >
        EL MESÓN
      </div>
      {[
        ["Andalusian gazpacho", "€8"],
        ["Spanish omelette", "€10"],
        ["Valencian paella", "€18"],
        ["Galician octopus", "€16"],
        ["Catalan custard", "€7"],
      ].map(([dish, price], i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: interFamily,
            fontSize: 20,
            color: PALETTE.text,
            padding: "4px 0",
          }}
        >
          <span>{dish}</span>
          <span style={{ color: PALETTE.textDim }}>{price}</span>
        </div>
      ))}
    </div>
  );
};

const ImageMode: React.FC<{ frame: number; opacity: number }> = ({
  frame,
  opacity,
}) => {
  const IMAGE_CMD = "tl translate --image IMG_2421.jpg --to en";
  const cmdTyped = typeSlice({
    frame,
    text: IMAGE_CMD,
    start: 18,
    charFrames: 1.0,
  });
  const cmdTypeEnd = 18 + Math.ceil(IMAGE_CMD.length * 1.0);
  const cardOpacity = interpolate(
    frame,
    [cmdTypeEnd + 4, cmdTypeEnd + 22],
    [0, 1],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const cardX = interpolate(
    frame,
    [cmdTypeEnd + 4, cmdTypeEnd + 22],
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
  const cmdOpacity = interpolate(frame, [12, 24], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div style={{ display: "flex", gap: 64, alignItems: "center" }}>
        <MenuPhoto />
        <TranslatedCard opacity={cardOpacity} x={cardX} />
      </div>
      <div
        style={{
          position: "absolute",
          top: 70,
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
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: cmdOpacity,
        }}
      >
        <div
          style={{
            background: PALETTE.surface,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: 10,
            padding: "14px 24px",
            fontFamily: monoFamily,
            fontSize: 22,
            color: PALETTE.text,
            letterSpacing: 0.4,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span style={{ color: PALETTE.accent }}>$</span>
          <span>{cmdTyped}</span>
          {frame < cmdTypeEnd ? (
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
