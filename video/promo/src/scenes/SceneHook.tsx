import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { FPS, PALETTE } from "../theme";
import { interFamily, monoFamily } from "../fonts";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 0.7, 0);

const FadeLine: React.FC<{
  text: string;
  start: number;
  hold: number;
  out: number;
  size?: number;
  weight?: number;
  color?: string;
  rise?: number;
}> = ({
  text,
  start,
  hold,
  out,
  size = 92,
  weight = 700,
  color = PALETTE.text,
  rise = 18,
}) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const fadeIn = 12;
  const fadeOut = 10;
  const opacity =
    interpolate(local, [0, fadeIn], [0, 1], {
      easing: EASE_OUT,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) -
    interpolate(local, [hold - fadeOut, hold], [0, 1], {
      easing: EASE_IN,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  if (local < -2 || local > hold + 2) return null;
  const y = interpolate(local, [0, fadeIn], [rise, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 120px",
      }}
    >
      <div
        style={{
          fontFamily: interFamily,
          fontSize: size,
          fontWeight: weight,
          color,
          letterSpacing: -1.6,
          lineHeight: 1.05,
          opacity,
          transform: `translateY(${y}px)`,
          textAlign: "center",
          maxWidth: 1500,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const LogoLockup: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const fadeIn = 14;
  const opacity = interpolate(local, [0, fadeIn], [0, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(local, [0, fadeIn], [22, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(local, [0, fadeIn], [0.96, 1], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (local < -2) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        opacity,
        transform: `translateY(${y}px) scale(${scale})`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: monoFamily,
            fontSize: 180,
            fontWeight: 700,
            letterSpacing: -8,
            color: PALETTE.text,
            lineHeight: 1,
          }}
        >
          tl
        </div>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: PALETTE.accent,
            transform: "translateY(-12px)",
            boxShadow: `0 0 36px ${PALETTE.accent}55`,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: interFamily,
          fontSize: 40,
          fontWeight: 500,
          color: PALETTE.textDim,
          letterSpacing: 0.2,
        }}
      >
        translate locally.
      </div>
    </div>
  );
};

export const SceneHook: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bg }}>
      <FadeLine
        text="Translation APIs are expensive."
        start={6}
        hold={1.4 * FPS}
        out={10}
      />
      <FadeLine
        text="And they read your data."
        start={Math.round(1.7 * FPS)}
        hold={1.4 * FPS}
        out={10}
        color={PALETTE.danger}
      />
      <LogoLockup start={Math.round(3.5 * FPS)} />
    </AbsoluteFill>
  );
};
