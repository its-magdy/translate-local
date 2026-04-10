import { SelectRenderable, type CliRenderer } from "@opentui/core";
import { LANG_NAMES } from "@translate-local/shared/constants";

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
}

export function makeLangPicker(
  renderer: CliRenderer,
  id: string,
  defaultCode: string,
  includeAuto: boolean,
): LangPicker {
  const options = includeAuto ? LANG_OPTIONS_WITH_AUTO : LANG_OPTIONS_NO_AUTO;
  const idx = options.findIndex(o => o.value === defaultCode);
  const initialIndex = idx >= 0 ? idx : 0;
  const renderable = new SelectRenderable(renderer, {
    id,
    width: 22,
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
  };
}
