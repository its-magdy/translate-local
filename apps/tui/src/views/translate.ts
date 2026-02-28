import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type CliRenderer,
} from "@opentui/core";
import { runPipeline } from "@tl/core/pipeline";
import { TlError } from "@tl/shared/errors";
import type { AppState } from "../index";
import { makeLangPicker } from "./widgets";
import { C } from "../theme";

export interface View {
  container: BoxRenderable;
  focus(): void;
}

export function makeTranslateView(state: AppState, parent: BoxRenderable): View {
  const { renderer, adapter, glossaryStore, config } = state;

  const container = new BoxRenderable(renderer, {
    id: "translate-view",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  parent.add(container);

  // ── Lang row ────────────────────────────────────────────────────────────────
  const langRow = new BoxRenderable(renderer, {
    id: "translate-lang-row",
    flexDirection: "row",
    height: 1,
    width: "100%",
  });
  container.add(langRow);

  langRow.add(new TextRenderable(renderer, { id: "from-label", content: "FROM ", fg: C.textMuted }));
  const fromPicker = makeLangPicker(renderer, "translate-from-select", config.defaults?.sourceLang ?? "auto", true);
  langRow.add(fromPicker.renderable);

  langRow.add(new TextRenderable(renderer, { id: "arrow-label", content: "  →  ", fg: C.accent }));
  langRow.add(new TextRenderable(renderer, { id: "to-label", content: "TO ", fg: C.textMuted }));
  const toPicker = makeLangPicker(renderer, "translate-to-select", config.defaults?.targetLang ?? "fr", false);
  langRow.add(toPicker.renderable);

  langRow.add(new TextRenderable(renderer, { id: "translate-hint", content: "  ⌨  Ctrl+Enter", fg: C.textMuted }));

  // ── Split row ────────────────────────────────────────────────────────────────
  const splitRow = new BoxRenderable(renderer, {
    id: "translate-split",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  container.add(splitRow);

  // Left pane — source input
  const leftPane = new BoxRenderable(renderer, {
    id: "translate-left",
    flexDirection: "column",
    flexGrow: 1,
    width: "50%",
    border: true,
    borderStyle: "single",
    borderColor: C.borderMuted,
    title: " SOURCE ",
    titleAlignment: "left",
  });
  splitRow.add(leftPane);

  const RTL_RE = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

  const sourceTextarea = new TextareaRenderable(renderer, {
    id: "translate-source",
    width: "100%",
    flexGrow: 1,
    placeholder: "Enter text… paste an image or path to translate",
    keyBindings: [{ name: "return", ctrl: true, action: "submit" }],
    onSubmit: () => triggerTranslate(),
  });
  leftPane.add(sourceTextarea);

  const srcRtlPreview = new TextRenderable(renderer, {
    id: "translate-src-rtl-preview",
    content: "",
    fg: C.textMuted,
    height: 1,
    width: "100%",
  });
  leftPane.add(srcRtlPreview);

  sourceTextarea.onContentChange = () => {
    const text = sourceTextarea.plainText;
    const lastLine = text.split("\n").filter(Boolean).at(-1) ?? "";
    if (lastLine && RTL_RE.test(lastLine)) {
      srcRtlPreview.content = `→ ${lastLine}`;
    } else {
      srcRtlPreview.content = "";
    }
  };

  // Right pane — translation output
  const rightPane = new BoxRenderable(renderer, {
    id: "translate-right",
    flexDirection: "column",
    flexGrow: 1,
    width: "50%",
    border: true,
    borderStyle: "single",
    borderColor: C.borderMuted,
    title: " TRANSLATION ",
    titleAlignment: "left",
  });
  splitRow.add(rightPane);

  const outputScroll = new ScrollBoxRenderable(renderer, {
    id: "translate-output-scroll",
    flexGrow: 1,
    width: "100%",
    scrollY: true,
    scrollX: false,
    stickyScroll: true,
    stickyStart: "top",
  });
  rightPane.add(outputScroll);

  // ── Status line ──────────────────────────────────────────────────────────────
  const statusContainer = new BoxRenderable(renderer, {
    id: "translate-status-container",
    height: 1,
    width: "100%",
    flexDirection: "row",
  });
  container.add(statusContainer);

  const shortcuts = new TextRenderable(renderer, {
    id: "status-shortcuts",
    content: " Ctrl+Enter translate · Tab switch · Ctrl+Q quit",
    fg: C.textMuted,
  });
  statusContainer.add(shortcuts);

  function updateStatus(dot: string, dotColor: string, text: string) {
    statusContainer.remove("status-dot");
    statusContainer.remove("status-text");
    statusContainer.add(new TextRenderable(renderer, { id: "status-dot", content: `● `, fg: dotColor }));
    statusContainer.add(new TextRenderable(renderer, { id: "status-text", content: text + "  ", fg: C.textSecondary }));
  }

  const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

  function paneWidth(): number {
    return Math.floor(renderer.width / 2) - 4; // subtract borders + padding
  }

  function wrapText(text: string, width: number): string {
    if (width <= 0) return text;
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.length <= width) {
        lines.push(paragraph);
        continue;
      }
      const words = paragraph.split(" ");
      let current = "";
      for (const word of words) {
        if (word.length > width) {
          if (current) { lines.push(current); current = ""; }
          for (let i = 0; i < word.length; i += width) {
            lines.push(word.slice(i, i + width));
          }
          continue;
        }
        if (current.length === 0) {
          current = word;
        } else if (current.length + 1 + word.length <= width) {
          current += " " + word;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }
    return lines.join("\n");
  }

  function rtlAlign(text: string): string {
    const w = paneWidth();
    // OpenTUI renders left-to-right so Arabic must be character-reversed per
    // word to appear correctly, matching what the glossary view does.
    return text.split("\n").map((line) => {
      const reversed = line.split(" ").map((word) => [...word].reverse().join("")).reverse().join(" ");
      const pad = Math.max(0, w - reversed.length);
      return " ".repeat(pad) + reversed;
    }).join("\n");
  }

  function updateOutput(text: string) {
    outputScroll.content.remove("output-text");
    if (text) {
      const targetLang = toPicker.getValue().toLowerCase().split("-")[0];
      const isRtl = RTL_LANGS.has(targetLang);
      const wrapped = wrapText(text, paneWidth());
      const content = isRtl ? rtlAlign(wrapped) : wrapped;
      outputScroll.content.add(new TextRenderable(renderer, { id: "output-text", content }));
    }
  }

  updateStatus("●", C.textMuted, "Ready");

  const IMAGE_EXTS = /\.(png|jpg|jpeg|webp|gif|bmp)$/i;
  // Matches a single-quoted image path anywhere in the text, e.g. '/path/to/photo.png'
  const IMAGE_TOKEN_RE = /'([^'\n]+\.(png|jpg|jpeg|webp|gif|bmp))'/i;

  // Auto-wrap image paths pasted into the textarea (e.g. drag-drop from Finder)
  renderer.keyInput.on("paste", (event) => {
    if (!sourceTextarea.focused) return;
    const text = event.text.trim();
    const unquoted = text.startsWith("'") && text.endsWith("'")
      ? text.slice(1, -1)
      : text.replace(/\\ /g, " ");
    if (unquoted.split("\n").length === 1 && IMAGE_EXTS.test(unquoted)) {
      event.preventDefault();
      sourceTextarea.insertText(`'${unquoted}' `);
    }
  });

  let loading = false;

  function triggerTranslate() {
    if (loading || !container.visible) return;

    const raw = sourceTextarea.plainText.trim();
    if (!raw) return;

    const sourceLang = fromPicker.getValue();
    const targetLang = toPicker.getValue();

    loading = true;
    updateOutput("");

    (async () => {
      let imageBase64: string | undefined;
      let textToTranslate: string;

      const embeddedMatch = raw.match(IMAGE_TOKEN_RE);

      if (embeddedMatch) {
        // Image token embedded in text: Translate this: 'photo.png' what does it say?
        const imagePath = embeddedMatch[1].replace(/\\ /g, " ");
        textToTranslate = raw.replace(IMAGE_TOKEN_RE, "").trim();
        updateStatus("●", C.amber, "Translating image…");
        try {
          const buf = await Bun.file(imagePath).arrayBuffer();
          imageBase64 = Buffer.from(buf).toString("base64");
        } catch (err) {
          updateStatus("●", C.red, `Image error: ${err instanceof Error ? err.message : String(err)}`);
          loading = false;
          return;
        }
      } else {
        // Legacy: entire input is a bare or macOS-quoted single-line image path
        const stripped = raw.startsWith("'") && raw.endsWith("'")
          ? raw.slice(1, -1)
          : raw.replace(/\\ /g, " ");
        const isImagePath = stripped.split("\n").length === 1 && IMAGE_EXTS.test(stripped);

        if (isImagePath) {
          updateStatus("●", C.amber, "Translating image…");
          try {
            const buf = await Bun.file(stripped).arrayBuffer();
            imageBase64 = Buffer.from(buf).toString("base64");
            textToTranslate = "";
          } catch (err) {
            updateStatus("●", C.red, `Image error: ${err instanceof Error ? err.message : String(err)}`);
            loading = false;
            return;
          }
        } else {
          textToTranslate = stripped;
          updateStatus("●", C.amber, "Translating…");
        }
      }

      runPipeline(textToTranslate, sourceLang, targetLang, adapter, glossaryStore, { imageBase64 })
        .then((result) => {
          updateOutput(result.translated);
          updateStatus("●", C.accent, `Coverage ${Math.round(result.glossaryCoverage * 100)}%  ·  ${result.metadata.durationMs}ms`);
        })
        .catch((err: unknown) => {
          const msg = err instanceof TlError ? `[${err.tag}] ${err.hint}` : String(err);
          updateStatus("●", C.red, `Error: ${msg}`);
        })
        .finally(() => {
          loading = false;
        });
    })();
  }

  return {
    container,
    focus() {
      sourceTextarea.focus();
    },
  };
}
