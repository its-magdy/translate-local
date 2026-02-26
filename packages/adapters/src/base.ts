import type { TranslationRequest } from "@tl/shared/types";

// BCP-47 code → display name mapping for TranslateGemma prompt template
const LANG_NAMES: Record<string, string> = {
  en: "English", ar: "Arabic", bg: "Bulgarian", bn: "Bengali", ca: "Catalan",
  cs: "Czech", da: "Danish", de: "German", el: "Greek", es: "Spanish",
  et: "Estonian", fa: "Persian", fi: "Finnish", fil: "Filipino", fr: "French",
  gu: "Gujarati", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian",
  id: "Indonesian", is: "Icelandic", it: "Italian", ja: "Japanese", kn: "Kannada",
  ko: "Korean", lt: "Lithuanian", lv: "Latvian", ml: "Malayalam", mr: "Marathi",
  nl: "Dutch", no: "Norwegian", pa: "Punjabi", pl: "Polish", pt: "Portuguese",
  ro: "Romanian", ru: "Russian", sk: "Slovak", sl: "Slovenian", sr: "Serbian",
  sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu", th: "Thai",
  tr: "Turkish", uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese", zh: "Chinese",
  zu: "Zulu",
};

function langLabel(code: string): string {
  const name = LANG_NAMES[code.toLowerCase()];
  return name ? `${name} (${code})` : code;
}

/**
 * Builds a prompt using the official TranslateGemma template format.
 * All instructions go in the prompt itself (model ignores system field for translation).
 */
export function buildStructuredPrompt(request: TranslationRequest): { prompt: string; system?: string } {
  const src = langLabel(request.sourceLang);
  const tgt = langLabel(request.targetLang);
  const srcName = LANG_NAMES[request.sourceLang.toLowerCase()] ?? request.sourceLang;
  const tgtName = LANG_NAMES[request.targetLang.toLowerCase()] ?? request.targetLang;

  const lines: string[] = [
    `You are a professional ${src} to ${tgt} translator. Your goal is to accurately convey the meaning and nuances of the original ${srcName} text while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.`,
    `Produce only the ${tgtName} translation, without any additional explanations or commentary.`,
  ];

  if (request.glossaryHits && request.glossaryHits.length > 0) {
    lines.push(`When you encounter <term translation="X">word</term> in the text, replace that word with exactly X — use the exact form provided, without adding articles, inflections, or diacritics. Never output the XML tags themselves.`);
  }

  lines.push(`Please translate the following ${srcName} text into ${tgtName}:`);
  lines.push(""); // blank line
  lines.push(""); // second blank line (required by model)

  if (request.contextSnippets && request.contextSnippets.length > 0) {
    for (const snippet of request.contextSnippets) {
      lines.push(snippet);
    }
    lines.push("");
  }

  lines.push(request.source);

  return { prompt: lines.join("\n") };
}

/**
 * Builds a natural language prompt for generic LLMs (non-TranslateGemma).
 */
export function buildNaturalPrompt(request: TranslationRequest): string {
  const lines: string[] = [];

  lines.push(
    `You are a professional translator. Translate the following text from ${request.sourceLang} to ${request.targetLang}.`
  );
  lines.push("Output only the translation, nothing else. Preserve the line breaks and paragraph structure of the source text.");

  if (request.glossaryHits && request.glossaryHits.length > 0) {
    lines.push("\nUse these specific translations for the following terms:");
    for (const hit of request.glossaryHits) {
      lines.push(`- "${hit.entry.sourceTerm}" → "${hit.entry.targetTerm}"`);
    }
  }

  if (request.contextSnippets && request.contextSnippets.length > 0) {
    lines.push("\nContext:");
    for (const snippet of request.contextSnippets) {
      lines.push(snippet);
    }
  }

  lines.push(`\nText to translate:\n${request.source}`);

  return lines.join("\n");
}
