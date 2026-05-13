import { PALETTE } from "../theme";
import { monoFamily } from "../fonts";

export const TRAFFIC: React.FC = () => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#ff5f57",
          display: "inline-block",
        }}
      />
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#febc2e",
          display: "inline-block",
        }}
      />
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#28c840",
          display: "inline-block",
        }}
      />
    </div>
  );
};

export const TerminalWindow: React.FC<{
  title?: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title = "~ — tl", width, height, children, style }) => {
  return (
    <div
      style={{
        width,
        height,
        background: PALETTE.surface,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow:
          "0 24px 60px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.04) inset",
        border: `1px solid ${PALETTE.border}`,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div
        style={{
          height: 44,
          background: PALETTE.bgElevated,
          borderBottom: `1px solid ${PALETTE.border}`,
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 18px",
        }}
      >
        <div style={{ justifySelf: "start" }}>
          <TRAFFIC />
        </div>
        <div
          style={{
            fontFamily: monoFamily,
            fontSize: 14,
            color: PALETTE.textMuted,
            letterSpacing: 0.2,
            justifySelf: "center",
          }}
        >
          {title}
        </div>
        <div />
      </div>
      <div
        style={{
          flex: 1,
          padding: "26px 32px",
          fontFamily: monoFamily,
          fontSize: 24,
          color: PALETTE.text,
          lineHeight: 1.55,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const BlinkCursor: React.FC<{
  frame: number;
  blinkFrames?: number;
  color?: string;
}> = ({ frame, blinkFrames = 16, color = PALETTE.text }) => {
  const on = frame % blinkFrames < blinkFrames / 2;
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.55em",
        height: "1em",
        background: color,
        verticalAlign: "-0.12em",
        marginLeft: 2,
        opacity: on ? 1 : 0,
      }}
    />
  );
};

export const Prompt: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  return (
    <span>
      <span style={{ color: PALETTE.accent }}>$</span>{" "}
      <span>{children}</span>
    </span>
  );
};

export const typeSlice = ({
  frame,
  text,
  start = 0,
  charFrames = 1.2,
}: {
  frame: number;
  text: string;
  start?: number;
  charFrames?: number;
}): string => {
  const local = frame - start;
  if (local <= 0) return "";
  const n = Math.min(text.length, Math.floor(local / charFrames));
  return text.slice(0, n);
};
