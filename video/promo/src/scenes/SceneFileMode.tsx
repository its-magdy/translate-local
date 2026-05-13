import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { PALETTE } from "../theme";
import { interFamily, monoFamily } from "../fonts";
import {
  BlinkCursor,
  Prompt,
  TerminalWindow,
  typeSlice,
} from "../components/Terminal";
import { JsonViewer, JsonNode, renderJson } from "../components/JsonViewer";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

const COMMAND = `tl translate --file locales/en.json --to ar`;

const EN_TREE: JsonNode = {
  kind: "object",
  entries: [
    { kind: "leaf", key: "welcome", value: "Welcome back, {username}" },
    {
      kind: "object",
      key: "cart",
      entries: [
        { kind: "leaf", key: "title", value: "Your cart" },
        { kind: "leaf", key: "items", value: "{count} items" },
      ],
    },
    { kind: "leaf", key: "checkout", value: "Continue to checkout" },
    {
      kind: "object",
      key: "errors",
      entries: [
        {
          kind: "leaf",
          key: "network",
          value: "Network error. Try again.",
        },
      ],
    },
  ],
};

const AR_TREE: JsonNode = {
  kind: "object",
  entries: [
    {
      kind: "leaf",
      key: "welcome",
      value: "مرحبًا بعودتك، {username}",
      arabic: true,
    },
    {
      kind: "object",
      key: "cart",
      entries: [
        { kind: "leaf", key: "title", value: "سلة التسوق", arabic: true },
        {
          kind: "leaf",
          key: "items",
          value: "{count} عنصر",
          arabic: true,
        },
      ],
    },
    {
      kind: "leaf",
      key: "checkout",
      value: "إتمام الشراء",
      arabic: true,
    },
    {
      kind: "object",
      key: "errors",
      entries: [
        {
          kind: "leaf",
          key: "network",
          value: "خطأ في الشبكة. حاول مرة أخرى.",
          arabic: true,
        },
      ],
    },
  ],
};

const LEAF_KEYS = ["welcome", "title", "items", "checkout", "network"];
const LEAF_VALUES: Record<string, string> = {
  welcome: "مرحبًا بعودتك، {username}",
  title: "سلة التسوق",
  items: "{count} عنصر",
  checkout: "إتمام الشراء",
  network: "خطأ في الشبكة. حاول مرة أخرى.",
};

const PANES_IN = 14;
const TYPE_START = 28;
const CHAR_FRAMES = 1.1;
const TYPE_END = TYPE_START + Math.ceil(COMMAND.length * CHAR_FRAMES);
const PAUSE_END = TYPE_END + 14;
const STREAM_START = PAUSE_END;
const LEAF_STEP = 56;
const LEAF_TYPE_FRAMES = 32;
const LAST_LEAF_START = STREAM_START + (LEAF_KEYS.length - 1) * LEAF_STEP;
const STREAM_END = LAST_LEAF_START + LEAF_TYPE_FRAMES + 14;
const CAPTION_START = STREAM_END + 6;

export const SceneFileMode: React.FC = () => {
  const frame = useCurrentFrame();

  const panesOpacity = interpolate(frame, [0, PANES_IN], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const leftX = interpolate(frame, [0, PANES_IN], [-40, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rightX = interpolate(frame, [0, PANES_IN], [40, 0], {
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
  const showInputCursor = frame >= TYPE_START && frame < PAUSE_END;

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
    [12, 0],
    {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  const arVisibleKey = (key: string) => {
    const idx = LEAF_KEYS.indexOf(key);
    if (idx < 0) return { typed: "", flashPlaceholders: false };
    const start = STREAM_START + idx * LEAF_STEP;
    const fullText = LEAF_VALUES[key];
    const typedText = typeSlice({
      frame,
      text: fullText,
      start,
      charFrames: LEAF_TYPE_FRAMES / Math.max(fullText.length, 1),
    });
    const flash =
      frame >= start && frame < start + LEAF_TYPE_FRAMES + 20;
    return { typed: typedText, flashPlaceholders: flash };
  };

  const placeholderPulse = (() => {
    const idx = Math.max(
      0,
      Math.min(
        LEAF_KEYS.length - 1,
        Math.floor((frame - STREAM_START) / LEAF_STEP),
      ),
    );
    const start = STREAM_START + idx * LEAF_STEP;
    const local = frame - start;
    if (local < 0) return 0;
    if (local > LEAF_TYPE_FRAMES + 14) return 0;
    return Math.sin((local / (LEAF_TYPE_FRAMES + 14)) * Math.PI);
  })();

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bg }}>
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 40,
          opacity: panesOpacity,
        }}
      >
        <div style={{ transform: `translateX(${leftX}px)` }}>
          <JsonViewer filename="locales/en.json" width={780} height={600}>
            {renderJson({ node: EN_TREE })}
          </JsonViewer>
        </div>
        <div style={{ transform: `translateX(${rightX}px)` }}>
          <JsonViewer filename="locales/ar.json" width={780} height={600}>
            {renderJson({
              node: AR_TREE,
              visibleKey: arVisibleKey,
              placeholderPulse,
            })}
          </JsonViewer>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 180,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: panesOpacity,
        }}
      >
        <TerminalWindow width={1200} height={170} title="~ — tl translate --file">
          <div style={{ fontSize: 22 }}>
            <Prompt>
              <span style={{ color: PALETTE.text }}>{typed}</span>
              {showInputCursor ? <BlinkCursor frame={frame} /> : null}
            </Prompt>
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: monoFamily,
              fontSize: 16,
              color: PALETTE.textMuted,
              opacity: frame >= STREAM_END ? 1 : 0,
            }}
          >
            ↳ wrote locales/ar.json · 5 keys · placeholders preserved
          </div>
        </TerminalWindow>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: interFamily,
          fontSize: 30,
          fontWeight: 500,
          color: PALETTE.textDim,
          letterSpacing: 0.2,
          opacity: captionOpacity,
          transform: `translateY(${captionY}px)`,
        }}
      >
        i18n catalogs. Placeholders intact.
      </div>
    </AbsoluteFill>
  );
};
