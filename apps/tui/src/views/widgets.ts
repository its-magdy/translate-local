import { SelectRenderable, type CliRenderer } from "@opentui/core";

export const SUPPORTED_LANGUAGES = [
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
  const renderable = new SelectRenderable(renderer, {
    id,
    width: 22,
    height: 1,
    options,
    showDescription: false,
    wrapSelection: true,
    selectedIndex: idx >= 0 ? idx : 0,
  });
  return {
    renderable,
    getValue() {
      return renderable.getSelectedOption()?.value ?? defaultCode;
    },
  };
}
