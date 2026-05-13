import { monoFamily, arabicFamily } from "../fonts";

const TUI_BG = "#16181c";
const TUI_CHROME_BG = "#3a3d42";
const TUI_TEXT = "#d6d9de";
const TUI_DIM = "#7d8088";
const TUI_MUTED = "#5b5e65";
const TUI_YELLOW = "#d4c019";
const TUI_YELLOW_SOFT = "rgba(212,192,25,0.18)";
const TUI_ROW_HIGHLIGHT = "#262b34";
const TUI_BORDER = "#262830";
const TUI_GREEN = "#65b965";

const MAC_TRAFFIC: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: "50%",
        background: "#ff5f57",
        display: "inline-block",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)",
      }}
    />
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: "50%",
        background: "#febc2e",
        display: "inline-block",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)",
      }}
    />
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: "50%",
        background: "#28c840",
        display: "inline-block",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)",
      }}
    />
  </div>
);

export const MacTerminalChrome: React.FC<{
  width: number;
  height: number;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ width, height, title = "mohamedomarwork — tl — 80×24", children, style }) => {
  return (
    <div
      style={{
        width,
        height,
        background: TUI_BG,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow:
          "0 30px 80px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.04) inset",
        border: "1px solid #1f2228",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div
        style={{
          height: 36,
          background:
            "linear-gradient(180deg, #50535a 0%, #404348 100%)",
          borderBottom: "1px solid #1f2228",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 14px",
        }}
      >
        <div style={{ justifySelf: "start" }}>
          <MAC_TRAFFIC />
        </div>
        <div
          style={{
            justifySelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: monoFamily,
            fontSize: 14,
            color: "#e8eaed",
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: 14 }}>📁</span>
          <span>{title}</span>
        </div>
        <div />
      </div>
      <div
        style={{
          flex: 1,
          background: TUI_BG,
          padding: "20px 24px",
          fontFamily: monoFamily,
          color: TUI_TEXT,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
};

const TabBar: React.FC<{ active: "translate" | "glossary" }> = ({ active }) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr 1fr",
        alignItems: "stretch",
        marginBottom: 18,
        fontSize: 22,
      }}
    >
      <div
        style={{
          color: TUI_DIM,
          padding: "8px 18px 8px 4px",
          borderRight: `1px solid ${TUI_BORDER}`,
          alignSelf: "center",
        }}
      >
        tl
      </div>
      <div
        style={{
          padding: "10px 22px 6px",
          color: active === "translate" ? TUI_TEXT : TUI_DIM,
          borderBottom:
            active === "translate"
              ? `3px solid ${TUI_YELLOW}`
              : "3px solid transparent",
        }}
      >
        <span style={{ color: TUI_YELLOW, marginRight: 8 }}>⇄</span>
        Translate
      </div>
      <div
        style={{
          padding: "10px 22px 6px",
          color: active === "glossary" ? TUI_TEXT : TUI_DIM,
          borderBottom:
            active === "glossary"
              ? `3px solid ${TUI_YELLOW}`
              : "3px solid transparent",
        }}
      >
        <span style={{ color: TUI_YELLOW, marginRight: 8 }}>↳</span>
        Glossary
      </div>
    </div>
  );
};

const FromToChips: React.FC<{
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  hint?: string;
}> = ({ from, fromLabel, to, toLabel, hint = "⌐ Ctrl+T" }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 18,
        fontSize: 20,
      }}
    >
      <span style={{ color: TUI_DIM }}>FROM</span>
      <span
        style={{
          background: TUI_YELLOW_SOFT,
          color: TUI_YELLOW,
          padding: "3px 12px",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>▶</span>
        <span style={{ fontWeight: 700 }}>{from}</span>
        <span style={{ color: TUI_DIM, marginLeft: 6 }}>{fromLabel}</span>
      </span>
      <span style={{ color: TUI_DIM }}>→</span>
      <span style={{ color: TUI_DIM }}>TO</span>
      <span
        style={{
          background: TUI_YELLOW_SOFT,
          color: TUI_YELLOW,
          padding: "3px 12px",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>▶</span>
        <span style={{ fontWeight: 700 }}>{to}</span>
        <span style={{ color: TUI_DIM, marginLeft: 6 }}>{toLabel}</span>
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ color: TUI_MUTED, fontSize: 18 }}>{hint}</span>
    </div>
  );
};

const Footer: React.FC<{
  hints: Array<{ key: string; label: string }>;
  status?: { text: string; dot?: string };
  right?: React.ReactNode;
}> = ({ hints, status, right }) => {
  return (
    <div
      style={{
        marginTop: "auto",
        paddingTop: 16,
        display: "flex",
        alignItems: "center",
        gap: 18,
        fontSize: 18,
        color: TUI_DIM,
      }}
    >
      {hints.map((h, i) => (
        <span key={i}>
          <span style={{ color: TUI_TEXT }}>{h.key}</span> {h.label}
          {i < hints.length - 1 ? <span style={{ marginLeft: 16, color: TUI_MUTED }}>·</span> : null}
        </span>
      ))}
      <div style={{ flex: 1 }} />
      {status ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: TUI_TEXT,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: status.dot ?? TUI_GREEN,
              display: "inline-block",
            }}
          />
          {status.text}
        </span>
      ) : null}
      {right}
    </div>
  );
};

const Pane: React.FC<{
  label: string;
  children: React.ReactNode;
  rtl?: boolean;
  arabic?: boolean;
}> = ({ label, children, rtl = false, arabic = false }) => {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          color: TUI_DIM,
          fontSize: 16,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          paddingLeft: rtl ? 0 : 4,
          paddingRight: rtl ? 4 : 0,
          textAlign: rtl ? "right" : "left",
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          border: `1px solid ${TUI_BORDER}`,
          padding: "18px 22px",
          color: TUI_TEXT,
          fontFamily: arabic ? arabicFamily : monoFamily,
          fontSize: arabic ? 34 : 24,
          direction: rtl ? "rtl" : "ltr",
          textAlign: rtl ? "right" : "left",
          lineHeight: 1.55,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const TlTuiTranslate: React.FC<{
  sourceText: string;
  sourcePlaceholder?: string;
  targetText: string;
  showSourceCaret?: boolean;
  caretOn?: boolean;
}> = ({
  sourceText,
  sourcePlaceholder = "Enter text… paste an image or path to translate",
  targetText,
  showSourceCaret = false,
  caretOn = true,
}) => {
  return (
    <>
      <TabBar active="translate" />
      <FromToChips
        from="auto"
        fromLabel="Auto-detect"
        to="ar"
        toLabel="Arabic"
      />
      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        <Pane label="Source">
          {sourceText.length > 0 ? (
            <>
              <span>{sourceText}</span>
              {showSourceCaret ? (
                <span
                  style={{
                    display: "inline-block",
                    width: "0.55em",
                    height: "1em",
                    background: TUI_YELLOW,
                    verticalAlign: "-0.12em",
                    marginLeft: 2,
                    opacity: caretOn ? 1 : 0,
                  }}
                />
              ) : null}
            </>
          ) : (
            <span style={{ color: TUI_MUTED }}>{sourcePlaceholder}</span>
          )}
        </Pane>
        <Pane label="Translation" rtl arabic>
          {targetText}
        </Pane>
      </div>
      <Footer
        hints={[
          { key: "Ctrl+T", label: "translate" },
          { key: "Tab", label: "switch" },
          { key: "Ctrl+Q", label: "quit" },
        ]}
        status={{ text: "Ready" }}
      />
    </>
  );
};

export type GlossaryRow = {
  id: string;
  source: string;
  translation: string;
  pair: string;
};

export const TlTuiGlossary: React.FC<{
  rows: GlossaryRow[];
  highlightIndex?: number;
}> = ({ rows, highlightIndex = 0 }) => {
  return (
    <>
      <TabBar active="glossary" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "150px 1fr 1.4fr 110px",
          padding: "6px 10px",
          color: TUI_DIM,
          fontSize: 16,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        <span>ID</span>
        <span>Source Term</span>
        <span>Translation</span>
        <span>Pair</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {rows.map((r, i) => {
          const hi = i === highlightIndex;
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "150px 1fr 1.4fr 110px",
                padding: "6px 10px",
                background: hi ? TUI_ROW_HIGHLIGHT : "transparent",
                color: TUI_TEXT,
                fontSize: 22,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: TUI_MUTED,
                  fontSize: 18,
                }}
              >
                {r.id}
              </span>
              <span>{r.source}</span>
              <span
                style={{
                  fontFamily: arabicFamily,
                  fontSize: 28,
                  color: TUI_TEXT,
                }}
              >
                {r.translation}
              </span>
              <span style={{ color: TUI_DIM, fontSize: 18 }}>{r.pair}</span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 18,
          alignItems: "center",
          fontSize: 18,
          paddingTop: 14,
          marginTop: 10,
          borderTop: `1px solid ${TUI_BORDER}`,
        }}
      >
        <div>
          <div style={{ color: TUI_DIM, fontSize: 15, marginBottom: 4 }}>
            source term
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: TUI_DIM }}>FROM</span>
            <span
              style={{
                background: TUI_YELLOW_SOFT,
                color: TUI_YELLOW,
                padding: "2px 10px",
              }}
            >
              <span>▶ </span>
              <span style={{ fontWeight: 700 }}>en</span>
              <span style={{ color: TUI_DIM, marginLeft: 8 }}>English</span>
            </span>
          </div>
        </div>
        <div>
          <div style={{ color: TUI_DIM, fontSize: 15, marginBottom: 4 }}>
            target term
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: TUI_DIM }}>→ TO</span>
            <span
              style={{
                background: TUI_YELLOW_SOFT,
                color: TUI_YELLOW,
                padding: "2px 10px",
              }}
            >
              <span>▶ </span>
              <span style={{ fontWeight: 700 }}>ar</span>
              <span style={{ color: TUI_DIM, marginLeft: 8 }}>Arabic</span>
            </span>
          </div>
        </div>
        <div style={{ color: TUI_DIM }}>
          <span style={{ color: TUI_YELLOW }}>[Enter]</span> + Add
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontSize: 17,
          color: TUI_DIM,
          marginTop: 12,
        }}
      >
        <span>
          <span style={{ color: TUI_TEXT }}>↑↓</span> navigate
        </span>
        <span style={{ color: TUI_MUTED }}>·</span>
        <span>
          <span style={{ color: TUI_TEXT }}>Ctrl+D</span> delete
        </span>
        <span style={{ color: TUI_MUTED }}>·</span>
        <span>
          <span style={{ color: TUI_TEXT }}>Tab</span> switch view
        </span>
        <span style={{ color: TUI_MUTED }}>·</span>
        <span>
          <span style={{ color: TUI_TEXT }}>Ctrl+Q</span> quit
        </span>
        <div style={{ flex: 1 }} />
        <span>{rows.length} entries</span>
      </div>
    </>
  );
};
