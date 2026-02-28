import { SelectRenderable, type CliRenderer } from "@opentui/core";
import { LANG_NAMES } from "@tl/shared/constants";

export const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  ...Object.entries(LANG_NAMES).map(([code, name]) => ({ code, name })),
];

const LANG_OPTIONS_WITH_AUTO = SUPPORTED_LANGUAGES.map(l => ({
  name: `${l.code.padEnd(6)} ${l.name}`,
  description: "",
  value: l.code,
}));

const LANG_OPTIONS_NO_AUTO = SUPPORTED_LANGUAGES.filter(l => l.code !== "auto").map(l => ({
  name: `${l.code.padEnd(6)} ${l.name}`,
  description: "",
  value: l.code,
}));

export interface LangPicker {
  renderable: SelectRenderable;
  getValue(): string;
  getSearchQuery(): string;
}

export function makeLangPicker(
  renderer: CliRenderer,
  id: string,
  defaultCode: string,
  includeAuto: boolean,
  /** Fixed chars consumed by labels/arrows/hints in the same row (excluding the two pickers). */
  rowOverhead = 29,
): LangPicker {
  const options = includeAuto ? LANG_OPTIONS_WITH_AUTO : LANG_OPTIONS_NO_AUTO;
  const idx = options.findIndex(o => o.value === defaultCode);
  const initialIndex = idx >= 0 ? idx : 0;
  const width = Math.max(20, Math.floor((renderer.width - rowOverhead) / 2));
  const renderable = new SelectRenderable(renderer, {
    id,
    width,
    height: 1,
    options,
    showDescription: false,
    wrapSelection: true,
    selectedIndex: initialIndex,
  });
  // The constructor sets _selectedIndex but never calls updateScrollOffset, so
  // scrollOffset stays 0 and the widget shows item 0 regardless of selectedIndex.
  // Force the setter's change detection by briefly resetting to 0, then restoring.
  if (initialIndex > 0) {
    renderable.selectedIndex = 0;
    renderable.selectedIndex = initialIndex;
  }
  return {
    renderable,
    getValue() {
      return renderable.getSelectedOption()?.value ?? defaultCode;
    },
    getSearchQuery() { return ""; },
  };
}

export function makeSearchableLangPicker(
  renderer: CliRenderer,
  id: string,
  defaultCode: string,
  includeAuto: boolean,
  rowOverhead = 29,
): LangPicker {
  const allOptions = includeAuto ? LANG_OPTIONS_WITH_AUTO : LANG_OPTIONS_NO_AUTO;
  const idx = allOptions.findIndex(o => o.value === defaultCode);
  const initialIndex = idx >= 0 ? idx : 0;
  const width = Math.max(20, Math.floor((renderer.width - rowOverhead) / 2));
  const renderable = new SelectRenderable(renderer, {
    id,
    width,
    height: 1,
    options: allOptions,
    showDescription: false,
    wrapSelection: true,
    selectedIndex: initialIndex,
  });
  if (initialIndex > 0) {
    renderable.selectedIndex = 0;
    renderable.selectedIndex = initialIndex;
  }

  let searchQuery = "";

  function applyFilter() {
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? allOptions.filter(o => o.name.toLowerCase().includes(q))
      : allOptions;
    renderable.options = filtered.length ? filtered : allOptions;
    renderable.selectedIndex = 0;
  }

  renderer.keyInput.on("keypress", (key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => {
    if (!renderable.focused) return;
    if (key.ctrl || key.meta) return;

    if (key.name === "backspace") {
      if (searchQuery.length > 0) {
        searchQuery = searchQuery.slice(0, -1);
        applyFilter();
      }
      return;
    }

    if (key.name === "escape") {
      searchQuery = "";
      applyFilter();
      // let existing escape handler (blur) run
      return;
    }

    // Printable single characters
    const seq = key.sequence ?? "";
    if (seq.length === 1 && seq >= " ") {
      searchQuery += seq;
      applyFilter();
    }
  });

  renderable.on("blurred", () => {
    searchQuery = "";
    renderable.options = allOptions;
  });

  return {
    renderable,
    getValue() {
      return renderable.getSelectedOption()?.value ?? defaultCode;
    },
    getSearchQuery() { return searchQuery; },
  };
}
