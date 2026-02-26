import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { runPipeline } from "@tl/core/pipeline";
import { TlError } from "@tl/shared/errors";
import type { AppState } from "../index";

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

  // Lang row
  const langRow = new BoxRenderable(renderer, {
    id: "translate-lang-row",
    flexDirection: "row",
    height: 3,
    width: "100%",
  });
  container.add(langRow);

  langRow.add(new TextRenderable(renderer, { id: "from-label", content: "From: " }));
  const fromInput = new InputRenderable(renderer, {
    id: "translate-from-input",
    width: 12,
    placeholder: "e.g. en",
  });
  fromInput.value = config.defaults?.sourceLang ?? "en";
  langRow.add(fromInput);

  langRow.add(new TextRenderable(renderer, { id: "to-label", content: "  To: " }));
  const toInput = new InputRenderable(renderer, {
    id: "translate-to-input",
    width: 12,
    placeholder: "e.g. fr",
  });
  toInput.value = config.defaults?.targetLang ?? "fr";
  langRow.add(toInput);

  langRow.add(new TextRenderable(renderer, { id: "translate-hint", content: "  [Ctrl+Enter] Translate", fg: "#666" }));

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
  leftPane.add(new TextRenderable(renderer, { id: "source-label", content: "Source", fg: "#aaa" }));
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
  rightPane.add(new TextRenderable(renderer, { id: "output-label", content: "Translation", fg: "#aaa" }));
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

  function updateStatus(text: string, color = "#888") {
    statusContainer.remove("status-text");
    statusContainer.add(new TextRenderable(renderer, { id: "status-text", content: text, fg: color }));
  }

  const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

  function rtlAlign(text: string): string {
    const paneWidth = Math.floor(renderer.width / 2) - 1;
    return text.split("\n").map((line) => {
      const pad = Math.max(0, paneWidth - line.length);
      return " ".repeat(pad) + line;
    }).join("\n");
  }

  function updateOutput(text: string) {
    outputContainer.remove("output-text");
    if (text) {
      const targetLang = toInput.value.trim().toLowerCase().split("-")[0];
      const content = RTL_LANGS.has(targetLang) ? rtlAlign(text) : text;
      outputContainer.add(new TextRenderable(renderer, { id: "output-text", content }));
    }
  }

  updateStatus("[Ctrl+Enter] translate · [Tab] switch tabs · [Ctrl+Q] quit");

  let loading = false;

  function triggerTranslate() {
    if (loading || !container.visible) return;

    const text = sourceTextarea.plainText.trim();
    if (!text) return;

    const sourceLang = fromInput.value.trim() || "en";
    const targetLang = toInput.value.trim() || "fr";

    loading = true;
    updateStatus("Translating...");
    updateOutput("");

    runPipeline(text, sourceLang, targetLang, adapter, glossaryStore)
      .then((result) => {
        updateOutput(result.translated);
        updateStatus(
          `Coverage: ${Math.round(result.glossaryCoverage * 100)}% · ${result.metadata.durationMs}ms  [Ctrl+Enter] translate · [Tab] switch tabs · [Ctrl+Q] quit`
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof TlError ? `[${err.tag}] ${err.hint}` : String(err);
        updateStatus(`Error: ${msg}`, "#f87171");
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
