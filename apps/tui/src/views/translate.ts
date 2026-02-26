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

const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  { code: "af", name: "Afrikaans" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "az", name: "Azerbaijani" },
  { code: "be", name: "Belarusian" },
  { code: "bg", name: "Bulgarian" },
  { code: "bn", name: "Bengali" },
  { code: "bs", name: "Bosnian" },
  { code: "ca", name: "Catalan" },
  { code: "cs", name: "Czech" },
  { code: "cy", name: "Welsh" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "et", name: "Estonian" },
  { code: "eu", name: "Basque" },
  { code: "fa", name: "Persian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "ga", name: "Irish" },
  { code: "gl", name: "Galician" },
  { code: "gu", name: "Gujarati" },
  { code: "ha", name: "Hausa" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hr", name: "Croatian" },
  { code: "hu", name: "Hungarian" },
  { code: "hy", name: "Armenian" },
  { code: "id", name: "Indonesian" },
  { code: "ig", name: "Igbo" },
  { code: "is", name: "Icelandic" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ka", name: "Georgian" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "kn", name: "Kannada" },
  { code: "ko", name: "Korean" },
  { code: "lo", name: "Lao" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "mk", name: "Macedonian" },
  { code: "ml", name: "Malayalam" },
  { code: "mn", name: "Mongolian" },
  { code: "mr", name: "Marathi" },
  { code: "ms", name: "Malay" },
  { code: "mt", name: "Maltese" },
  { code: "my", name: "Myanmar" },
  { code: "ne", name: "Nepali" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "pl", name: "Polish" },
  { code: "ps", name: "Pashto" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sd", name: "Sindhi" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "so", name: "Somali" },
  { code: "sq", name: "Albanian" },
  { code: "sr", name: "Serbian" },
  { code: "sv", name: "Swedish" },
  { code: "sw", name: "Swahili" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "th", name: "Thai" },
  { code: "tl", name: "Filipino" },
  { code: "tr", name: "Turkish" },
  { code: "ug", name: "Uyghur" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "zu", name: "Zulu" },
];

const LANG_OPTIONS_FROM = SUPPORTED_LANGUAGES.map(l => ({
  name: `${l.code.padEnd(6)} ${l.name}`,
  description: "",
  value: l.code,
}));

const LANG_OPTIONS_TO = SUPPORTED_LANGUAGES.filter(l => l.code !== "auto").map(l => ({
  name: `${l.code.padEnd(6)} ${l.name}`,
  description: "",
  value: l.code,
}));

function findLangIndex<T extends { value: string }>(options: T[], code: string): number {
  const idx = options.findIndex(o => o.value === code);
  return idx >= 0 ? idx : 0;
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

  // Lang row — taller to show select lists
  const langRow = new BoxRenderable(renderer, {
    id: "translate-lang-row",
    flexDirection: "row",
    height: 8,
    width: "100%",
  });
  container.add(langRow);

  langRow.add(new TextRenderable(renderer, { id: "from-label", content: "From\n" }));
  const fromSelect = new SelectRenderable(renderer, {
    id: "translate-from-select",
    width: 26,
    height: 8,
    options: LANG_OPTIONS_FROM,
    showDescription: false,
    wrapSelection: true,
    selectedIndex: findLangIndex(LANG_OPTIONS_FROM, config.defaults?.sourceLang ?? "auto"),
  });
  langRow.add(fromSelect);

  langRow.add(new TextRenderable(renderer, { id: "to-label", content: "  To\n" }));
  const toSelect = new SelectRenderable(renderer, {
    id: "translate-to-select",
    width: 26,
    height: 8,
    options: LANG_OPTIONS_TO,
    showDescription: false,
    wrapSelection: true,
    selectedIndex: findLangIndex(LANG_OPTIONS_TO, config.defaults?.targetLang ?? "fr"),
  });
  langRow.add(toSelect);

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
      const targetLang = (toSelect.getSelectedOption()?.value ?? "").toLowerCase().split("-")[0];
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

    const sourceLang = fromSelect.getSelectedOption()?.value ?? "auto";
    const targetLang = toSelect.getSelectedOption()?.value ?? "fr";

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
