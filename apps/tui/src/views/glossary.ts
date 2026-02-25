import {
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import type { GlossaryEntry } from "@tl/shared/types";
import type { AppState } from "../index";
import type { View } from "./translate";

export function makeGlossaryView(state: AppState, parent: BoxRenderable): View {
  const { renderer, glossaryStore } = state;

  const container = new BoxRenderable(renderer, {
    id: "glossary-view",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  parent.add(container);

  // List area
  const listContainer = new BoxRenderable(renderer, {
    id: "glossary-list",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  container.add(listContainer);

  // Add form
  const formContainer = new BoxRenderable(renderer, {
    id: "glossary-form",
    flexDirection: "row",
    height: 3,
    width: "100%",
  });
  container.add(formContainer);

  formContainer.add(new TextRenderable(renderer, { id: "src-label", content: "Src: " }));
  const srcInput = new InputRenderable(renderer, { id: "g-src-input", width: 16, placeholder: "source term" });
  formContainer.add(srcInput);

  formContainer.add(new TextRenderable(renderer, { id: "tgt-label", content: " Tgt: " }));
  const tgtInput = new InputRenderable(renderer, { id: "g-tgt-input", width: 16, placeholder: "target term" });
  formContainer.add(tgtInput);

  formContainer.add(new TextRenderable(renderer, { id: "from-label", content: " From: " }));
  const fromInput = new InputRenderable(renderer, { id: "g-from-input", width: 6, placeholder: "en" });
  formContainer.add(fromInput);

  formContainer.add(new TextRenderable(renderer, { id: "to-label-g", content: " To: " }));
  const toInput = new InputRenderable(renderer, { id: "g-to-input", width: 6, placeholder: "fr" });
  formContainer.add(toInput);

  // Footer
  const footer = new BoxRenderable(renderer, { id: "glossary-footer", height: 1, width: "100%" });
  container.add(footer);
  footer.add(new TextRenderable(renderer, {
    id: "glossary-footer-text",
    content: "[↑↓] navigate · [d] delete · [Tab] focus form · [Enter] add",
    fg: "#666",
  }));

  let selectedIdx = 0;
  let entries: GlossaryEntry[] = [];

  function refreshList() {
    listContainer.destroyRecursively();
    entries = glossaryStore.list();
    if (entries.length === 0) {
      listContainer.add(new TextRenderable(renderer, { id: "empty-msg", content: "No glossary entries. Add one below.", fg: "#666" }));
      return;
    }
    if (selectedIdx >= entries.length) selectedIdx = entries.length - 1;
    entries.forEach((e, idx) => {
      const row = new BoxRenderable(renderer, {
        id: `row-${e.id}`,
        flexDirection: "row",
        backgroundColor: idx === selectedIdx ? "#1e3a5f" : undefined,
      });
      row.add(new TextRenderable(renderer, { id: `id-${e.id}`, content: e.id.slice(0, 8), width: 10 }));
      row.add(new TextRenderable(renderer, { id: `src-${e.id}`, content: e.sourceTerm, width: 20 }));
      row.add(new TextRenderable(renderer, { id: `tgt-${e.id}`, content: e.targetTerm, width: 20 }));
      row.add(new TextRenderable(renderer, { id: `lng-${e.id}`, content: `${e.sourceLang}→${e.targetLang}`, width: 12 }));
      listContainer.add(row);
    });
  }

  refreshList();

  // List navigation keyboard
  renderer.keyInput.on("keypress", (key) => {
    if (!container.visible) return;
    if (key.name === "up") {
      if (selectedIdx > 0) { selectedIdx--; refreshList(); }
      return;
    }
    if (key.name === "down") {
      if (selectedIdx < entries.length - 1) { selectedIdx++; refreshList(); }
      return;
    }
    if (key.name === "d" && !key.ctrl) {
      if (entries[selectedIdx]) {
        glossaryStore.remove(entries[selectedIdx].id);
        refreshList();
      }
    }
  });

  // Add entry on Enter in last field
  toInput.on(InputRenderableEvents.ENTER, () => {
    const src = srcInput.value.trim();
    const tgt = tgtInput.value.trim();
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    if (!src || !tgt || !from || !to) return;

    glossaryStore.add({ sourceTerm: src, targetTerm: tgt, sourceLang: from, targetLang: to });
    srcInput.value = "";
    tgtInput.value = "";
    fromInput.value = "";
    toInput.value = "";
    refreshList();
  });

  return {
    container,
    focus() {
      srcInput.focus();
    },
  };
}
