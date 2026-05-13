import { PALETTE } from "../theme";
import { monoFamily, arabicFamily } from "../fonts";

export type JsonNode =
  | { kind: "object"; key?: string; entries: JsonNode[] }
  | { kind: "leaf"; key: string; value: string; arabic?: boolean };

export const renderJson = ({
  node,
  indent = 0,
  isLast = true,
  visibleKey,
  placeholderPulse,
}: {
  node: JsonNode;
  indent?: number;
  isLast?: boolean;
  visibleKey?: (path: string) => { typed: string; flashPlaceholders: boolean };
  placeholderPulse?: number;
}): React.ReactNode => {
  if (node.kind === "object") {
    const pad = "  ".repeat(indent);
    const trailing = isLast ? "" : ",";
    if (node.key === undefined) {
      return (
        <>
          <div>{pad}{"{"}</div>
          {node.entries.map((child, i) => (
            <div key={i}>
              {renderJson({
                node: child,
                indent: indent + 1,
                isLast: i === node.entries.length - 1,
                visibleKey,
                placeholderPulse,
              })}
            </div>
          ))}
          <div>{pad}{"}"}</div>
        </>
      );
    }
    return (
      <>
        <div>
          {pad}
          <span style={{ color: PALETTE.accent }}>&quot;{node.key}&quot;</span>: {"{"}
        </div>
        {node.entries.map((child, i) => (
          <div key={i}>
            {renderJson({
              node: child,
              indent: indent + 1,
              isLast: i === node.entries.length - 1,
              visibleKey,
              placeholderPulse,
            })}
          </div>
        ))}
        <div>
          {pad}
          {"}"}
          {trailing}
        </div>
      </>
    );
  }
  const pad = "  ".repeat(indent);
  const trailing = isLast ? "" : ",";
  const path = node.key;
  const view = visibleKey?.(path);
  const typed = view ? view.typed : node.value;
  return (
    <div>
      {pad}
      <span style={{ color: PALETTE.accent }}>&quot;{node.key}&quot;</span>:{" "}
      <span style={{ fontFamily: node.arabic ? arabicFamily : monoFamily }}>
        &quot;
        <Highlighted
          text={typed}
          arabic={node.arabic ?? false}
          flash={view?.flashPlaceholders ?? false}
          pulse={placeholderPulse ?? 0}
        />
        &quot;
      </span>
      {trailing}
    </div>
  );
};

const Highlighted: React.FC<{
  text: string;
  arabic: boolean;
  flash: boolean;
  pulse: number;
}> = ({ text, arabic, flash, pulse }) => {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const isPh = /^\{[^}]+\}$/.test(p);
        if (!isPh)
          return (
            <span key={i} style={{ color: arabic ? PALETTE.text : PALETTE.highlight }}>
              {p}
            </span>
          );
        return (
          <span
            key={i}
            style={{
              color: PALETTE.accent,
              fontFamily: monoFamily,
              background: flash
                ? `rgba(127,179,255,${0.1 + 0.3 * pulse})`
                : "transparent",
              padding: "0 3px",
              borderRadius: 4,
              boxShadow: flash
                ? `0 0 0 1px rgba(127,179,255,${0.5 * pulse})`
                : "none",
            }}
          >
            {p}
          </span>
        );
      })}
    </>
  );
};

export const JsonViewer: React.FC<{
  filename: string;
  width: number;
  height: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ filename, width, height, children, style }) => {
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
          height: 40,
          background: PALETTE.bgElevated,
          borderBottom: `1px solid ${PALETTE.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 14 }}>📄</span>
        <span
          style={{
            fontFamily: monoFamily,
            fontSize: 13,
            color: PALETTE.textDim,
            letterSpacing: 0.2,
          }}
        >
          {filename}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          padding: "18px 22px",
          fontFamily: monoFamily,
          fontSize: 19,
          color: PALETTE.textDim,
          lineHeight: 1.5,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
};
