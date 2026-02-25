import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  InputRenderable,
  type CliRenderer,
} from "@opentui/core";
import { runPipeline } from "@tl/core/pipeline";
import { MockAdapter } from "@tl/adapters/mock";
import { TlError } from "@tl/shared/errors";
import type { AppState } from "../index";
import type { View } from "./translate";

export function makeCompareView(state: AppState, parent: BoxRenderable): View {
  const { renderer, adapter, glossaryStore } = state;
  const mockAdapter = new MockAdapter();

  const container = new BoxRenderable(renderer, {
    id: "compare-view",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  parent.add(container);

  // Top: source input + langs
  const topArea = new BoxRenderable(renderer, {
    id: "compare-top",
    flexDirection: "column",
    height: 6,
    width: "100%",
  });
  container.add(topArea);

  const langRow = new BoxRenderable(renderer, { id: "compare-lang-row", flexDirection: "row", height: 3, width: "100%" });
  topArea.add(langRow);
  langRow.add(new TextRenderable(renderer, { id: "c-from-label", content: "From: " }));
  const fromInput = new InputRenderable(renderer, { id: "c-from-input", width: 10, placeholder: "en" });
  fromInput.value = "en";
  langRow.add(fromInput);
  langRow.add(new TextRenderable(renderer, { id: "c-to-label", content: "  To: " }));
  const toInput = new InputRenderable(renderer, { id: "c-to-input", width: 10, placeholder: "fr" });
  toInput.value = "fr";
  langRow.add(toInput);
  langRow.add(new TextRenderable(renderer, { id: "c-hint", content: "  [Ctrl+Enter] Compare", fg: "#666" }));

  const sourceTextarea = new TextareaRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    placeholder: "Enter text to compare...",
  });
  topArea.add(sourceTextarea);

  // Middle: two output panes
  const outputRow = new BoxRenderable(renderer, {
    id: "compare-output-row",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  container.add(outputRow);

  // Primary adapter pane
  const primaryPane = new BoxRenderable(renderer, { id: "compare-primary-pane", flexDirection: "column", flexGrow: 1 });
  outputRow.add(primaryPane);
  primaryPane.add(new TextRenderable(renderer, { id: "primary-label", content: "Primary Adapter", fg: "#60a5fa" }));
  const primaryContainer = new BoxRenderable(renderer, { id: "primary-output-container", flexGrow: 1, width: "100%" });
  primaryPane.add(primaryContainer);

  // Mock adapter pane
  const mockPane = new BoxRenderable(renderer, { id: "compare-mock-pane", flexDirection: "column", flexGrow: 1 });
  outputRow.add(mockPane);
  mockPane.add(new TextRenderable(renderer, { id: "mock-label", content: "Mock Adapter", fg: "#a3e635" }));
  const mockContainer = new BoxRenderable(renderer, { id: "mock-output-container", flexGrow: 1, width: "100%" });
  mockPane.add(mockContainer);

  // Status
  const statusContainer = new BoxRenderable(renderer, { id: "compare-status", height: 1, width: "100%" });
  container.add(statusContainer);

  function updateStatus(text: string) {
    statusContainer.remove("compare-status-text");
    statusContainer.add(new TextRenderable(renderer, { id: "compare-status-text", content: text, fg: "#888" }));
  }

  function updatePane(containerId: "primary-output-container" | "mock-output-container", paneContainer: BoxRenderable, textId: string, text: string) {
    paneContainer.remove(textId);
    paneContainer.add(new TextRenderable(renderer, { id: textId, content: text }));
  }

  updateStatus("[Ctrl+Enter] compare · [Tab] switch tabs");

  let loading = false;

  renderer.keyInput.on("keypress", (key) => {
    if (!key.ctrl || key.name !== "return") return;
    if (loading) return;
    if (!container.visible) return;

    const text = sourceTextarea.plainText.trim();
    if (!text) return;

    const sourceLang = fromInput.value.trim() || "en";
    const targetLang = toInput.value.trim() || "fr";

    loading = true;
    updateStatus("Comparing...");
    updatePane("primary-output-container", primaryContainer, "primary-text", "");
    updatePane("mock-output-container", mockContainer, "mock-text", "");

    Promise.allSettled([
      runPipeline(text, sourceLang, targetLang, adapter, glossaryStore),
      runPipeline(text, sourceLang, targetLang, mockAdapter, glossaryStore),
    ]).then(([primary, mock]) => {
      updatePane(
        "primary-output-container",
        primaryContainer,
        "primary-text",
        primary.status === "fulfilled"
          ? primary.value.translated
          : `Error: ${primary.reason instanceof TlError ? primary.reason.hint : String(primary.reason)}`
      );
      updatePane(
        "mock-output-container",
        mockContainer,
        "mock-text",
        mock.status === "fulfilled"
          ? mock.value.translated
          : `Error: ${mock.reason instanceof TlError ? mock.reason.hint : String(mock.reason)}`
      );
      loading = false;
      updateStatus("Done");
    });
  });

  return {
    container,
    focus() {
      sourceTextarea.focus();
    },
  };
}
