import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily, arabicFamily } from "../fonts";
import { TerminalWindow, typeSlice } from "../components/Terminal";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 0.7, 0);

const IMAGE_END = 120;
const TUI_START = 115;
const TUI_TYPE_START = TUI_START + 30;
const TUI_TYPE_TEXT = "Welcome back to your account";
const TUI_TYPE_CHAR_FRAMES = 1.4;
const TUI_TYPE_END =
  TUI_TYPE_START + Math.ceil(TUI_TYPE_TEXT.length * TUI_TYPE_CHAR_FRAMES);
const TUI_STREAM_START = TUI_TYPE_END + 10;
const TUI_AR_TEXT = "مرحبًا بعودتك إلى حسابك";
const TUI_STREAM_CHAR_FRAMES = 2.4;
const TUI_STREAM_END =
  TUI_STREAM_START +
  Math.ceil(TUI_AR_TEXT.length * TUI_STREAM_CHAR_FRAMES);
const TAB_SWITCH = TUI_STREAM_END + 12;

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

const TuiPane: React.FC<{
  title: string;
  children: React.ReactNode;
  active?: boolean;
  rtl?: boolean;
  arabic?: boolean;
}> = ({ title, children, active = false, rtl = false, arabic = false }) => {
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
        borderRadius: 10,
        background: PALETTE.bgElevated,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 16px",
          fontFamily: monoFamily,
          fontSize: 14,
          color: active ? PALETTE.accent : PALETTE.textMuted,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          padding: "24px 28px",
          fontFamily: arabic ? arabicFamily : monoFamily,
          fontSize: arabic ? 38 : 28,
          color: PALETTE.text,
          direction: rtl ? "rtl" : "ltr",
          textAlign: rtl ? "right" : "left",
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
};

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

  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity }}
    >
      <TerminalWindow width={1500} height={760} title="tl — interactive">
        <div
          style={{
            display: "flex",
            gap: 28,
            marginBottom: 22,
            fontFamily: monoFamily,
            fontSize: 18,
          }}
        >
          <span
            style={{
              color: tabSwitched ? PALETTE.textMuted : PALETTE.text,
              borderBottom: tabSwitched
                ? "2px solid transparent"
                : `2px solid ${PALETTE.accent}`,
              paddingBottom: 6,
              fontWeight: tabSwitched ? 400 : 700,
            }}
          >
            ◉ Translate
          </span>
          <span
            style={{
              color: tabSwitched ? PALETTE.text : PALETTE.textMuted,
              borderBottom: tabSwitched
                ? `2px solid ${PALETTE.accent}`
                : "2px solid transparent",
              paddingBottom: 6,
              fontWeight: tabSwitched ? 700 : 400,
            }}
          >
            ◯ Glossary
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ color: PALETTE.textMuted }}>
            en → ar · translategemma:latest
          </span>
        </div>
        {tabSwitched ? (
          <div
            style={{
              border: `1px solid ${PALETTE.border}`,
              borderRadius: 10,
              padding: "20px 24px",
              fontFamily: monoFamily,
              fontSize: 20,
              color: PALETTE.text,
              lineHeight: 1.7,
            }}
          >
            <div
              style={{
                color: PALETTE.textMuted,
                fontSize: 13,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              5 terms · en → ar
            </div>
            <div>machine learning → <span style={{ fontFamily: arabicFamily, color: PALETTE.highlight }}>تعلم الآلة</span></div>
            <div>neural network → <span style={{ fontFamily: arabicFamily, color: PALETTE.highlight }}>شبكة عصبية</span></div>
            <div>login → <span style={{ fontFamily: arabicFamily, color: PALETTE.highlight }}>تسجيل الدخول</span></div>
            <div>signup → <span style={{ fontFamily: arabicFamily, color: PALETTE.highlight }}>التسجيل</span></div>
            <div>dashboard → <span style={{ fontFamily: arabicFamily, color: PALETTE.highlight }}>لوحة التحكم</span></div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 22, height: 560 }}>
            <TuiPane title="SOURCE · EN" active>
              {typed}
              {frame < TUI_TYPE_END ? (
                <span
                  style={{
                    display: "inline-block",
                    width: "0.55em",
                    height: "1em",
                    background: PALETTE.accent,
                    verticalAlign: "-0.12em",
                    marginLeft: 2,
                    opacity: frame % 16 < 8 ? 1 : 0,
                  }}
                />
              ) : null}
            </TuiPane>
            <TuiPane title="TARGET · AR" rtl arabic>
              {arabicTyped}
            </TuiPane>
          </div>
        )}
      </TerminalWindow>
      <div
        style={{
          position: "absolute",
          top: 80,
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
    interpolate(frame, [IMAGE_END, IMAGE_END + 15], [0, 1], {
      easing: EASE_IN,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

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
      {frame <= IMAGE_END + 15 ? (
        <ImageMode frame={frame} opacity={imageOpacity} />
      ) : null}
      {frame >= TUI_START ? (
        <TuiMode frame={frame} opacity={tuiOpacity} />
      ) : null}
    </AbsoluteFill>
  );
};
