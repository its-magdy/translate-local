import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily, arabicFamily } from "../fonts";
import {
  BlinkCursor,
  Prompt,
  TerminalWindow,
  typeSlice,
} from "../components/Terminal";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const COMMAND = `tl "Translate locally. Own your data." --to ar`;
const ARABIC_TOKENS = ["ترجم", " ", "محليًا", ".", " ", "تملك", " ", "بياناتك", "."];

const TYPE_START = 14;
const CHAR_FRAMES = 1.4;
const TYPE_END = TYPE_START + Math.ceil(COMMAND.length * CHAR_FRAMES);
const PAUSE_END = TYPE_END + 18;
const STREAM_START = PAUSE_END;
const STREAM_PER = 11;
const STREAM_END = STREAM_START + ARABIC_TOKENS.length * STREAM_PER;
const CAPTION_START = STREAM_END + 8;

export const SceneColdOpen: React.FC = () => {
  const frame = useCurrentFrame();

  const windowOpacity = interpolate(frame, [0, 12], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const windowY = interpolate(frame, [0, 14], [30, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const windowScale = interpolate(frame, [0, 14], [0.98, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const typed = typeSlice({
    frame,
    text: COMMAND,
    start: TYPE_START,
    charFrames: CHAR_FRAMES,
  });

  const streamedTokens = Math.max(
    0,
    Math.min(
      ARABIC_TOKENS.length,
      Math.floor((frame - STREAM_START) / STREAM_PER),
    ),
  );
  const arabicVisible = ARABIC_TOKENS.slice(0, streamedTokens).join("");

  const showInputCursor = frame >= TYPE_START && frame < PAUSE_END;
  const showOutputCursor =
    frame >= STREAM_START && frame < STREAM_END + 6;

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
          opacity: windowOpacity,
          transform: `translateY(${windowY}px) scale(${windowScale})`,
          transformOrigin: "center",
        }}
      >
        <TerminalWindow width={1320} height={520}>
          <div style={{ marginBottom: 18 }}>
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
              fontSize: 56,
              fontWeight: 500,
              color: PALETTE.text,
              minHeight: 80,
              lineHeight: 1.4,
            }}
          >
            <span>{arabicVisible}</span>
            {showOutputCursor && arabicVisible.length > 0 ? (
              <span
                style={{
                  display: "inline-block",
                  width: "0.5em",
                  height: "0.9em",
                  background: PALETTE.accent,
                  verticalAlign: "-0.1em",
                  marginRight: 4,
                  opacity: frame % 16 < 8 ? 1 : 0,
                }}
              />
            ) : null}
          </div>
          <div
            style={{
              marginTop: 26,
              fontFamily: monoFamily,
              fontSize: 16,
              color: PALETTE.textMuted,
              opacity: frame >= STREAM_END ? 1 : 0,
            }}
          >
            ↳ via translategemma:latest · local · 312 ms
          </div>
        </TerminalWindow>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 88,
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
        Runs on your machine. No API key.
      </div>
    </AbsoluteFill>
  );
};
