import {
  BoxRenderable,
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

  // Lang row — compact, height 1
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

  // Split row
  const splitRow = new BoxRenderable(renderer, {
    id: "translate-split",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  container.add(splitRow);

  // Left pane (source)
  const leftPane = new BoxRenderable(renderer, {
    id: "translate-left",
    flexDirection: "column",
    flexGrow: 1,
  });
  splitRow.add(leftPane);
  leftPane.add(new TextRenderable(renderer, { id: "source-label", content: "SOURCE", fg: C.textSecondary }));
  leftPane.add(new TextRenderable(renderer, { id: "source-sep", content: "─".repeat(60), fg: C.borderMuted }));
  const sourceTextarea = new TextareaRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    placeholder: "Enter text to translate...",
    keyBindings: [{ name: "return", ctrl: true, action: "submit" }],
    onSubmit: () => triggerTranslate(),
  });
  leftPane.add(sourceTextarea);

  // Right pane (output)
  const rightPane = new BoxRenderable(renderer, {
    id: "translate-right",
    flexDirection: "column",
    flexGrow: 1,
  });
  splitRow.add(rightPane);
  rightPane.add(new TextRenderable(renderer, { id: "output-label", content: "TRANSLATION", fg: C.textSecondary }));
  rightPane.add(new TextRenderable(renderer, { id: "output-sep", content: "─".repeat(60), fg: C.borderMuted }));
  const outputContainer = new BoxRenderable(renderer, {
    id: "translate-output-container",
    flexGrow: 1,
    width: "100%",
  });
  rightPane.add(outputContainer);

  // Status line
  const statusContainer = new BoxRenderable(renderer, {
    id: "translate-status-container",
    height: 1,
    width: "100%",
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
    // prepend dot + text before shortcuts
    statusContainer.add(new TextRenderable(renderer, { id: "status-dot", content: `● `, fg: dotColor }));
    statusContainer.add(new TextRenderable(renderer, { id: "status-text", content: text + "  ", fg: C.textSecondary }));
  }

  const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

  function rtlAlign(text: string): string {
    const paneWidth = Math.floor(renderer.width / 2) - 1;
    return text.split("\n").map((line) => {
      // Reverse chars: OpenTUI uses explicit LTR cursor positioning, bypassing the
      // terminal's bidi engine. Reversing gives correct visual RTL order.
      const reversed = [...line].reverse().join("");
      const pad = Math.max(0, paneWidth - line.length);
      return " ".repeat(pad) + reversed;
    }).join("\n");
  }

  function updateOutput(text: string) {
    outputContainer.remove("output-text");
    if (text) {
      const targetLang = toPicker.getValue().toLowerCase().split("-")[0];
      const content = RTL_LANGS.has(targetLang) ? rtlAlign(text) : text;
      outputContainer.add(new TextRenderable(renderer, { id: "output-text", content }));
    }
  }

  updateStatus("●", C.textMuted, "Ready");

  let loading = false;

  function triggerTranslate() {
    if (loading || !container.visible) return;

    const text = sourceTextarea.plainText.trim();
    if (!text) return;

    const sourceLang = fromPicker.getValue();
    const targetLang = toPicker.getValue();

    loading = true;
    updateStatus("●", C.amber, "Translating…");
    updateOutput("");

    runPipeline(text, sourceLang, targetLang, adapter, glossaryStore)
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
  }

  return {
    container,
    focus() {
      sourceTextarea.focus();
    },
  };
}
