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
import { makeLangPicker } from "./widgets";
import { C } from "../theme";

export function makeGlossaryView(state: AppState, parent: BoxRenderable): View {
  const { renderer, glossaryStore } = state;

  const container = new BoxRenderable(renderer, {
    id: "glossary-view",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  parent.add(container);

  // Table header
  const tableHeader = new BoxRenderable(renderer, {
    id: "glossary-table-header",
    flexDirection: "row",
    height: 1,
    width: "100%",
  });
  container.add(tableHeader);
  tableHeader.add(new TextRenderable(renderer, { id: "th-id",  content: "ID      ",  fg: C.textMuted, width: 10 }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-src", content: "SOURCE TERM         ", fg: C.textMuted, width: 20 }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-tgt", content: "TRANSLATION         ", fg: C.textMuted, width: 20 }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-lng", content: "PAIR        ",        fg: C.textMuted, width: 12 }));

  // Header separator
  const headerSep = new BoxRenderable(renderer, { id: "glossary-header-sep", height: 1, width: "100%" });
  container.add(headerSep);
  headerSep.add(new TextRenderable(renderer, { id: "header-sep-line", content: "─".repeat(120), fg: C.borderSubtle }));

  // List area
  const listContainer = new BoxRenderable(renderer, {
    id: "glossary-list",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  container.add(listContainer);

  // Add form — two rows: text inputs on top, lang pickers below
  const formContainer = new BoxRenderable(renderer, {
    id: "glossary-form",
    flexDirection: "column",
    height: 2,
    width: "100%",
  });
  container.add(formContainer);

  const termRow = new BoxRenderable(renderer, { id: "glossary-term-row", flexDirection: "row", height: 1, width: "100%" });
  formContainer.add(termRow);
  termRow.add(new TextRenderable(renderer, { id: "src-label", content: "SRC ", fg: C.textMuted }));
  const srcInput = new InputRenderable(renderer, { id: "g-src-input", width: 20, placeholder: "source term" });
  termRow.add(srcInput);
  termRow.add(new TextRenderable(renderer, { id: "tgt-label", content: "  TGT ", fg: C.textMuted }));
  const tgtInput = new InputRenderable(renderer, { id: "g-tgt-input", width: 20, placeholder: "target term" });
  termRow.add(tgtInput);

  const langRow = new BoxRenderable(renderer, { id: "glossary-lang-row", flexDirection: "row", height: 1, width: "100%" });
  formContainer.add(langRow);
  langRow.add(new TextRenderable(renderer, { id: "from-label", content: "FROM ", fg: C.textMuted }));
  const fromPicker = makeLangPicker(renderer, "g-from-picker", "en", false);
  langRow.add(fromPicker.renderable);
  langRow.add(new TextRenderable(renderer, { id: "arrow-g", content: "  →  ", fg: C.accent }));
  langRow.add(new TextRenderable(renderer, { id: "to-label-g", content: "TO ", fg: C.textMuted }));
  const toPicker = makeLangPicker(renderer, "g-to-picker", "fr", false);
  langRow.add(toPicker.renderable);
  langRow.add(new TextRenderable(renderer, { id: "add-hint", content: "  [Enter] + Add", fg: C.accent }));

  // Footer
  const footer = new BoxRenderable(renderer, { id: "glossary-footer", flexDirection: "row", height: 1, width: "100%" });
  container.add(footer);
  footer.add(new TextRenderable(renderer, {
    id: "glossary-footer-text",
    content: "↑↓ navigate  ·  d delete  ·  Tab focus form  ·  Ctrl+Q quit  ",
    fg: C.textMuted,
  }));

  const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

  function rtlReverse(text: string): string {
    return [...text].reverse().join("");
  }

  let selectedIdx = 0;
  let entries: GlossaryEntry[] = [];
  let listFocused = true;

  [srcInput, tgtInput].forEach(input => {
    input.on("focus", () => { listFocused = false; });
    input.on("blur",  () => { listFocused = true; });
  });

  function refreshList() {
    for (const child of [...listContainer.getChildren()]) {
      listContainer.remove(child.id);
    }
    try {
      entries = glossaryStore.list();
    } catch {
      entries = [];
    }
    footer.remove("glossary-entry-count");
    footer.add(new TextRenderable(renderer, {
      id: "glossary-entry-count",
      content: `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
      fg: C.textMuted,
    }));
    if (entries.length === 0) {
      listContainer.add(new TextRenderable(renderer, { id: "empty-msg", content: "No glossary entries. Add one below.", fg: C.textMuted }));
      return;
    }
    if (selectedIdx >= entries.length) selectedIdx = entries.length - 1;
    entries.forEach((e, idx) => {
      const selected = idx === selectedIdx;
      const row = new BoxRenderable(renderer, {
        id: `row-${e.id}`,
        flexDirection: "row",
        backgroundColor: selected ? C.selectionBg : undefined,
      });
      row.add(new TextRenderable(renderer, { id: `id-${e.id}`,  content: e.id.slice(0, 8), width: 10, fg: C.textMuted }));
      row.add(new TextRenderable(renderer, { id: `src-${e.id}`, content: e.sourceTerm, width: 20, fg: C.textPrimary }));
      const isRtl = RTL_LANGS.has(e.targetLang.toLowerCase().split("-")[0]);
      const tgtDisplay = isRtl ? rtlReverse(e.targetTerm) : e.targetTerm;
      row.add(new TextRenderable(renderer, { id: `tgt-${e.id}`, content: tgtDisplay, width: 20, fg: C.textPrimary }));
      row.add(new TextRenderable(renderer, { id: `lng-${e.id}`, content: `[${e.sourceLang}→${e.targetLang}]`, width: 12, fg: C.textSecondary }));
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
    if (key.name === "d" && !key.ctrl && listFocused) {
      if (entries[selectedIdx]) {
        glossaryStore.remove(entries[selectedIdx].id);
        refreshList();
      }
    }
  });

  // Add entry on Enter in tgt field (last text input; lang pickers are already set)
  tgtInput.on(InputRenderableEvents.ENTER, () => {
    const src = srcInput.value.trim();
    const tgt = tgtInput.value.trim();
    const from = fromPicker.getValue();
    const to = toPicker.getValue();
    if (!src || !tgt) return;

    glossaryStore.add({ sourceTerm: src, targetTerm: tgt, sourceLang: from, targetLang: to });
    srcInput.value = "";
    tgtInput.value = "";
    refreshList();
  });

  return {
    container,
    focus() {
      srcInput.focus();
    },
  };
}
