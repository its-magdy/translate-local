import { PALETTE } from "../theme";
import { monoFamily } from "../fonts";

export type CsvRow = {
  source: string;
  target: string;
  from: string;
  to: string;
  domain: string;
};

export const CsvViewer: React.FC<{
  rows: CsvRow[];
  width: number;
  height: number;
  filename?: string;
  highlightIndex?: number;
  highlightOpacity?: number;
  style?: React.CSSProperties;
}> = ({
  rows,
  width,
  height,
  filename = "glossary.csv",
  highlightIndex,
  highlightOpacity = 1,
  style,
}) => {
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
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 16 }}>📄</span>
        <span
          style={{
            fontFamily: monoFamily,
            fontSize: 14,
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
          padding: "20px 22px",
          fontFamily: monoFamily,
          fontSize: 20,
          color: PALETTE.text,
          lineHeight: 1.6,
          overflow: "hidden",
        }}
      >
        <div style={{ color: PALETTE.textMuted, marginBottom: 8 }}>
          source,target,from,to,domain
        </div>
        {rows.map((row, i) => {
          const isHi = highlightIndex === i;
          return (
            <div
              key={i}
              style={{
                position: "relative",
                padding: "4px 12px",
                margin: "0 -12px",
                borderRadius: 6,
                background: isHi
                  ? `rgba(163,217,119,${0.12 * highlightOpacity})`
                  : "transparent",
                borderLeft: isHi
                  ? `3px solid rgba(163,217,119,${highlightOpacity})`
                  : "3px solid transparent",
                color: isHi ? PALETTE.text : PALETTE.textDim,
                transition: "none",
              }}
            >
              <span>"{row.source}",</span>
              <span
                style={{
                  color: isHi
                    ? `rgba(163,217,119,${0.5 + 0.5 * highlightOpacity})`
                    : PALETTE.textDim,
                  fontWeight: isHi ? 700 : 400,
                }}
              >
                "{row.target}"
              </span>
              <span>
                ,{row.from},{row.to},{row.domain}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
