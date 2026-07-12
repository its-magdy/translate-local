import type { TranslationRequest } from "@translate-local/shared/types";
import {
  LANG_NAMES,
  PLACEHOLDER_SENTINEL_PREFIX,
  PLACEHOLDER_SENTINEL_SUFFIX,
} from "@translate-local/shared/constants";

// File mode masks placeholders with these sentinels (see core files/placeholders);
// the prompt must enforce the exact same token format.
const SENTINEL_PATTERN = `${PLACEHOLDER_SENTINEL_PREFIX}\\d+${PLACEHOLDER_SENTINEL_SUFFIX}`;
const SENTINEL_TEST_RE = new RegExp(SENTINEL_PATTERN);
const SENTINEL_MATCH_RE = new RegExp(SENTINEL_PATTERN, "g");

function langLabel(code: string): string {
  const name = LANG_NAMES[code.toLowerCase()];
  return name ? `${name} (${code})` : code;
}

// translategemma ignores the system field for translation tasks — all instructions go in the prompt.
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

  // Without an explicit instruction the model drops __TLPH_N__ sentinels when fluency suffers.
  if (!isImageMode && SENTINEL_TEST_RE.test(request.source)) {
    const tokens = (request.source.match(SENTINEL_MATCH_RE) ?? []);
    const uniqueTokens = [...new Set(tokens)];
    lines.push(
      `CRITICAL PLACEHOLDER RULE: this source contains exactly ${tokens.length} placeholder occurrence(s) of the form __TLPH_N__. Specifically: ${uniqueTokens.join(", ")}. Your translation MUST contain EXACTLY THESE SAME TOKENS, with the same count. Even if the resulting sentence sounds awkward, you must include every placeholder. Do not omit, translate, or alter these tokens. Position them naturally in the target sentence.`,
      `EXAMPLES of correct placeholder preservation across languages:`,
      `  Source: "Hello __TLPH_0__, you have __TLPH_1__ messages"`,
      `  → Spanish: "Hola __TLPH_0__, tienes __TLPH_1__ mensajes"`,
      `  → Arabic: "مرحبًا __TLPH_0__، لديك __TLPH_1__ رسالة"`,
      `  → Japanese: "こんにちは __TLPH_0__ さん、__TLPH_1__ 件のメッセージがあります"`,
      `Notice each token appears exactly once in each translation, in a natural position. Apply the same discipline to your translation below.`,
    );
  }

  if (!isImageMode) {
    lines.push(`Please translate the following ${srcName} text into ${tgtName}:`);
    // Two blank lines are required by the translategemma prompt template.
    lines.push("");
    lines.push("");
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
