import type { TranslationRequest } from "@tl/shared/types";
import { LANG_NAMES } from "@tl/shared/constants";

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

  const isImageMode = !!request.imageBase64;
  const lines: string[] = [];

  if (isImageMode) {
    lines.push(`Extract all text from the image and translate it from ${src} to ${tgt}. Output only the translation.`);
  } else {
    lines.push(
      `You are a professional ${src} to ${tgt} translator. Your goal is to accurately convey the meaning and nuances of the original ${srcName} text while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.`,
      `Produce only the ${tgtName} translation, without any additional explanations or commentary.`,
    );
  }

  if (request.glossaryHits && request.glossaryHits.length > 0) {
    if (isImageMode) {
      lines.push(`Use these specific translations for the following terms: ${request.glossaryHits.map((h) => `"${h.entry.sourceTerm}" → "${h.entry.targetTerm}"`).join(", ")}.`);
    } else {
      lines.push(`When you encounter <term translation="X">word</term> in the text, replace that word with exactly X — use the exact form provided, without adding articles, inflections, or diacritics. Never output the XML tags themselves.`);
    }
  }

  if (!isImageMode) {
    lines.push(`Please translate the following ${srcName} text into ${tgtName}:`);
    lines.push(""); // blank line
    lines.push(""); // second blank line (required by model)
  }

  if (request.contextSnippets && request.contextSnippets.length > 0) {
    for (const snippet of request.contextSnippets) {
      lines.push(snippet);
    }
    lines.push("");
  }

  if (!isImageMode) {
    lines.push(request.source);
  }

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
