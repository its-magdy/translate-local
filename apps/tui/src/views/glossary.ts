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

  // Column widths derived from terminal width
  function colWidths(w: number) {
    const pair = 12;
    const id = 10;
    const term = Math.max(10, Math.floor((w - id - pair) / 2));
    return { id, term, pair };
  }

  // Table header
  const tableHeader = new BoxRenderable(renderer, {
    id: "glossary-table-header",
    flexDirection: "row",
    height: 1,
    width: "100%",
  });
  container.add(tableHeader);
  let cols = colWidths(renderer.width);
  tableHeader.add(new TextRenderable(renderer, { id: "th-id",  content: "ID",          fg: C.textMuted, width: cols.id }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-src", content: "SOURCE TERM", fg: C.textMuted, width: cols.term }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-tgt", content: "TRANSLATION", fg: C.textMuted, width: cols.term }));
  tableHeader.add(new TextRenderable(renderer, { id: "th-lng", content: "PAIR",        fg: C.textMuted, width: cols.pair }));

  // Header separator
  const headerSep = new BoxRenderable(renderer, { id: "glossary-header-sep", height: 1, width: "100%" });
  container.add(headerSep);
  const sepLine = new TextRenderable(renderer, { id: "header-sep-line", content: "─".repeat(renderer.width), fg: C.borderSubtle });
  headerSep.add(sepLine);

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
  function inputWidth(w: number) { return Math.max(10, Math.floor((w - 16) / 2)); }
  const srcInput = new InputRenderable(renderer, { id: "g-src-input", width: inputWidth(renderer.width), placeholder: "source term" });
  termRow.add(srcInput);
  const srcRtlPreview = new TextRenderable(renderer, { id: "g-src-rtl-preview", content: "", fg: C.textMuted });
  termRow.add(srcRtlPreview);
  termRow.add(new TextRenderable(renderer, { id: "tgt-label", content: "  TGT ", fg: C.textMuted }));
  const tgtInput = new InputRenderable(renderer, { id: "g-tgt-input", width: inputWidth(renderer.width), placeholder: "target term" });
  termRow.add(tgtInput);
  const rtlPreview = new TextRenderable(renderer, { id: "g-rtl-preview", content: "", fg: C.textMuted });
  termRow.add(rtlPreview);

  const langRow = new BoxRenderable(renderer, { id: "glossary-lang-row", flexDirection: "row", height: 1, width: "100%" });
  formContainer.add(langRow);
  langRow.add(new TextRenderable(renderer, { id: "from-label", content: "FROM ", fg: C.textMuted }));
  const fromPicker = makeLangPicker(renderer, "g-from-picker", "en", false, 28);
  langRow.add(fromPicker.renderable);
  langRow.add(new TextRenderable(renderer, { id: "arrow-g", content: "  →  ", fg: C.accent }));
  langRow.add(new TextRenderable(renderer, { id: "to-label-g", content: "TO ", fg: C.textMuted }));
  const toPicker = makeLangPicker(renderer, "g-to-picker", "fr", false, 28);
  langRow.add(toPicker.renderable);
  langRow.add(new TextRenderable(renderer, { id: "add-hint", content: "  [Enter] + Add", fg: C.accent }));

  // Footer
  const footer = new BoxRenderable(renderer, { id: "glossary-footer", flexDirection: "row", height: 1, width: "100%" });
  container.add(footer);
  footer.add(new TextRenderable(renderer, {
    id: "glossary-footer-text",
    content: "↑↓ navigate  ·  Ctrl+D delete  ·  Tab switch view  ·  Ctrl+Q quit  ",
    fg: C.textMuted,
  }));

  const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd", "ug"]);

  function rtlReverse(text: string): string {
    return [...text].reverse().join("");
  }

  let selectedIdx = 0;
  let entries: GlossaryEntry[] = [];

  const footerText = footer.getChildren()[0] as TextRenderable;

  function isAnyFormActive() {
    return srcInput.focused || tgtInput.focused
      || fromPicker.renderable.focused || toPicker.renderable.focused;
  }

  function updateFooterHint() {
    footerText.content = isAnyFormActive()
      ? "Tab next field  ·  Shift+Tab prev  ·  Esc cancel  ·  Enter add  ·  Ctrl+Q quit  "
      : "↑↓ navigate  ·  Ctrl+D delete  ·  Tab switch view  ·  Ctrl+Q quit  ";
  }

  [srcInput, tgtInput].forEach(input => {
    input.on("focus", updateFooterHint);
    input.on("blur",  updateFooterHint);
  });
  [fromPicker.renderable, toPicker.renderable].forEach(p => {
    p.on("focused", updateFooterHint);
    p.on("blurred", updateFooterHint);
  });

  function hasRtlChars(text: string): boolean {
    return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
  }

  srcInput.onContentChange = () => {
    const val = srcInput.value;
    srcRtlPreview.content = val && hasRtlChars(val) ? `→ ${val}` : "";
  };

  tgtInput.onContentChange = () => {
    const val = tgtInput.value;
    rtlPreview.content = val && hasRtlChars(val) ? `→ ${val}` : "";
  };

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
    const c = colWidths(renderer.width);
    entries.forEach((e, idx) => {
      const selected = idx === selectedIdx;
      const row = new BoxRenderable(renderer, {
        id: `row-${e.id}`,
        flexDirection: "row",
        backgroundColor: selected ? C.selectionBg : undefined,
      });
      row.add(new TextRenderable(renderer, { id: `id-${e.id}`,  content: e.id.slice(0, 8), width: c.id,   fg: C.textMuted }));
      row.add(new TextRenderable(renderer, { id: `src-${e.id}`, content: e.sourceTerm,      width: c.term, fg: C.textPrimary }));
      const isRtl = RTL_LANGS.has(e.targetLang.toLowerCase().split("-")[0]);
      const tgtDisplay = isRtl ? rtlReverse(e.targetTerm) : e.targetTerm;
      row.add(new TextRenderable(renderer, { id: `tgt-${e.id}`, content: tgtDisplay,        width: c.term, fg: C.textPrimary }));
      row.add(new TextRenderable(renderer, { id: `lng-${e.id}`, content: `[${e.sourceLang}→${e.targetLang}]`, width: c.pair, fg: C.textSecondary }));
      listContainer.add(row);
    });
  }

  refreshList();

  function updateSelection(newIdx: number) {
    const oldIdx = selectedIdx;
    selectedIdx = newIdx;
    // Only update background colors — no DB query, no DOM rebuild
    const children = listContainer.getChildren() as BoxRenderable[];
    const oldRow = children.find(c => c.id === `row-${entries[oldIdx]?.id}`);
    const newRow = children.find(c => c.id === `row-${entries[newIdx]?.id}`);
    if (oldRow) oldRow.backgroundColor = undefined;
    if (newRow) newRow.backgroundColor = C.selectionBg;
  }

  // List navigation keyboard
  renderer.keyInput.on("keypress", (key) => {
    if (!container.visible) return;

    // Form-active: Tab cycles all fields, Escape exits form
    if (isAnyFormActive()) {
      if (key.name === "tab") {
        if (!key.shift) {
          if (srcInput.focused)                  { srcInput.blur();               tgtInput.focus(); }
          else if (tgtInput.focused)              { tgtInput.blur();               fromPicker.renderable.focus(); }
          else if (fromPicker.renderable.focused) { fromPicker.renderable.blur();  toPicker.renderable.focus(); }
          else                                    { toPicker.renderable.blur();    srcInput.focus(); }
        } else {
          if (srcInput.focused)                  { srcInput.blur();               toPicker.renderable.focus(); }
          else if (tgtInput.focused)              { tgtInput.blur();               srcInput.focus(); }
          else if (fromPicker.renderable.focused) { fromPicker.renderable.blur();  tgtInput.focus(); }
          else                                    { toPicker.renderable.blur();    fromPicker.renderable.focus(); }
        }
        return;
      }
      if (key.name === "escape") {
        srcInput.blur();
        tgtInput.blur();
        fromPicker.renderable.blur();
        toPicker.renderable.blur();
        return;
      }
    }

    if (key.name === "up") {
      const pickerFocused = fromPicker.renderable.focused || toPicker.renderable.focused;
      if (!pickerFocused && selectedIdx > 0) updateSelection(selectedIdx - 1);
      return;
    }
    if (key.name === "down") {
      const pickerFocused = fromPicker.renderable.focused || toPicker.renderable.focused;
      if (!pickerFocused && selectedIdx < entries.length - 1) updateSelection(selectedIdx + 1);
      return;
    }
    if (key.name === "d" && key.ctrl) {
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
    srcRtlPreview.content = "";
    rtlPreview.content = "";
    tgtInput.blur();
    refreshList();
  });

  renderer.on("resize", (w: number) => {
    // Update separator
    sepLine.content = "─".repeat(w);
    // Update header column widths
    cols = colWidths(w);
    (tableHeader.getChildren() as TextRenderable[]).forEach((c, i) => {
      c.width = [cols.id, cols.term, cols.term, cols.pair][i] ?? c.width;
    });
    // Update inputs
    const iw = inputWidth(w);
    srcInput.width = iw;
    tgtInput.width = iw;
    // Update lang picker widths
    const pickerWidth = Math.max(10, Math.floor((w - 28) / 2));
    fromPicker.renderable.width = pickerWidth;
    toPicker.renderable.width = pickerWidth;
    // Rebuild list rows with new column widths
    refreshList();
  });

  return {
    container,
    focus() {
      srcInput.focus();
    },
    isFormActive() {
      return isAnyFormActive();
    },
  };
}
