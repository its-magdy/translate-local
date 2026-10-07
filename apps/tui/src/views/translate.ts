import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type CliRenderer,
} from "@opentui/core";
import { runPipeline } from "@translate-local/core/pipeline";
import { TlError } from "@translate-local/shared/errors";
import { IMAGE_EXT_RE, IMAGE_EXT_PATTERN, IMAGE_MAX_BYTES } from "@translate-local/shared/constants";
import { isRtlLang, hasRtlChars } from "@translate-local/shared/utils/language";
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

  langRow.add(new TextRenderable(renderer, { id: "translate-hint", content: "  ⌨  Ctrl+T", fg: C.textMuted }));

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

  const sourceTextarea = new TextareaRenderable(renderer, {
    id: "translate-source",
    width: "100%",
    flexGrow: 1,
    placeholder: "Enter text… paste an image or path to translate",
    keyBindings: [{ name: "t", ctrl: true, action: "submit" }],
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
    if (lastLine && hasRtlChars(lastLine)) {
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
    content: " Ctrl+T translate · Tab switch · Ctrl+Q quit",
    fg: C.textMuted,
  });
  statusContainer.add(shortcuts);

  function updateStatus(dotColor: string, text: string) {
    statusContainer.remove("status-dot");
    statusContainer.remove("status-text");
    statusContainer.add(new TextRenderable(renderer, { id: "status-dot", content: `● `, fg: dotColor }));
    statusContainer.add(new TextRenderable(renderer, { id: "status-text", content: text + "  ", fg: C.textSecondary }));
  }

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
    // The terminal applies BiDi itself, so just right-align — don't reverse.
    return text.split("\n").map((line) => {
      const pad = Math.max(0, w - line.length);
      return " ".repeat(pad) + line;
    }).join("\n");
  }

  function updateOutput(text: string) {
    outputScroll.content.remove("output-text");
    if (text) {
      const isRtl = isRtlLang(toPicker.getValue());
      const wrapped = wrapText(text, paneWidth());
      const content = isRtl ? rtlAlign(wrapped) : wrapped;
      outputScroll.content.add(new TextRenderable(renderer, { id: "output-text", content }));
    }
  }

  updateStatus(C.textMuted, "Ready");

  // Matches a single-quoted image path anywhere in the text, e.g. '/path/to/photo.png'
  const IMAGE_TOKEN_RE = new RegExp(`'([^'\\n]+${IMAGE_EXT_PATTERN})'`, "i");

  // Strip macOS single-quoting, or unescape backslash-escaped spaces.
  function unquotePath(text: string): string {
    return text.startsWith("'") && text.endsWith("'")
      ? text.slice(1, -1)
      : text.replace(/\\ /g, " ");
  }

  // Auto-wrap image paths pasted into the textarea (e.g. drag-drop from Finder)
  renderer.keyInput.on("paste", (event) => {
    if (!sourceTextarea.focused) return;
    const unquoted = unquotePath(new TextDecoder().decode(event.bytes).trim());
    if (unquoted.split("\n").length === 1 && IMAGE_EXT_RE.test(unquoted)) {
      event.preventDefault();
      sourceTextarea.insertText(`'${unquoted}' `);
    }
  });

  let activeAbort: AbortController | null = null;

  // Read an image file to base64. On failure, set the error status (unless the
  // request was aborted) and return null.
  async function loadImage(path: string, abort: AbortController): Promise<string | null> {
    updateStatus(C.amber, "Translating image…");
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) {
        if (!abort.signal.aborted) updateStatus(C.red, `Image not found: ${path}`);
        return null;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        if (!abort.signal.aborted) updateStatus(C.red, `Image exceeds 10 MB: ${path}`);
        return null;
      }
      const buf = await file.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    } catch (err) {
      if (!abort.signal.aborted) updateStatus(C.red, `Image error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  function triggerTranslate() {
    if (!container.visible) return;

    const raw = sourceTextarea.plainText.trim();
    if (!raw) return;

    // Cancel any in-flight translation so the new one takes over
    if (activeAbort) activeAbort.abort();
    const abort = new AbortController();
    activeAbort = abort;

    const sourceLang = fromPicker.getValue();
    const targetLang = toPicker.getValue();


    updateOutput("");

    (async () => {
      let imageBase64: string | undefined;
      let textToTranslate = "";

      const embeddedMatch = raw.match(IMAGE_TOKEN_RE);

      if (embeddedMatch) {
        // Image token embedded in text: Translate this: 'photo.png' what does it say?
        const imagePath = embeddedMatch[1].replace(/\\ /g, " ");
        textToTranslate = raw.replace(IMAGE_TOKEN_RE, "").trim();
        const b64 = await loadImage(imagePath, abort);
        if (b64 === null) return;
        imageBase64 = b64;
      } else {
        // Legacy: entire input is a bare or macOS-quoted single-line image path
        const stripped = unquotePath(raw);
        const isImagePath = stripped.split("\n").length === 1 && IMAGE_EXT_RE.test(stripped);

        if (isImagePath) {
          const b64 = await loadImage(stripped, abort);
          if (b64 === null) return;
          imageBase64 = b64;
        } else {
          textToTranslate = stripped;
          updateStatus(C.amber, "Translating…");
        }
      }

      if (abort.signal.aborted) return;

      let streamBuffer = "";
      let lastRenderMs = 0;
      runPipeline(textToTranslate, sourceLang, targetLang, adapter, glossaryStore, {
        imageBase64,
        onChunk: (chunk) => {
          if (abort.signal.aborted) return;
          streamBuffer += chunk;
          const now = Date.now();
          if (now - lastRenderMs >= 16) {
            lastRenderMs = now;
            updateOutput(streamBuffer);
          }
        },
      })
        .then((result) => {
          if (abort.signal.aborted) return;
          streamBuffer = "";
          updateOutput(result.translated);
          updateStatus(C.accent, `Coverage ${Math.round(result.glossaryCoverage * 100)}%  ·  ${result.metadata.durationMs}ms`);
        })
        .catch((err: unknown) => {
          if (abort.signal.aborted) return;
          const msg = err instanceof TlError ? `[${err.tag}] ${err.hint}` : String(err);
          updateStatus(C.red, `Error: ${msg}`);
        })
        .finally(() => {
          if (activeAbort === abort) activeAbort = null;
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
