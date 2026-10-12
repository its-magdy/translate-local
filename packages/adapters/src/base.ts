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
const TERM_ATTR_RE = /translation="[^"]*"/g;
// How the prompt names the token shape, and two example tokens that can never
// equal a real one (real tokens end in digits).
const SENTINEL_FORM = `${PLACEHOLDER_SENTINEL_PREFIX}N${PLACEHOLDER_SENTINEL_SUFFIX}`;
const EXAMPLE_TOKEN_A = `${PLACEHOLDER_SENTINEL_PREFIX}A${PLACEHOLDER_SENTINEL_SUFFIX}`;
const EXAMPLE_TOKEN_B = `${PLACEHOLDER_SENTINEL_PREFIX}B${PLACEHOLDER_SENTINEL_SUFFIX}`;

/** Placeholder sentinels in a source: total occurrences and each distinct token once. */
function sentinelTokens(source: string): { count: number; unique: string[] } | undefined {
  if (!SENTINEL_TEST_RE.test(source)) return undefined;
  // Tagged sentinels (<term translation="__TLPH_0__">__TLPH_0__</term>) would
  // count twice; drop the attribute values so only the text content counts.
  const tokens = source.replace(TERM_ATTR_RE, "").match(SENTINEL_MATCH_RE) ?? [];
  return { count: tokens.length, unique: [...new Set(tokens)] };
}

// "auto" is our CLI default, not a language: TranslateGemma's template has no
// auto mode, so the prompt leaves the source language out instead of naming "auto".
function isAutoSource(code: string): boolean {
  return code.toLowerCase() === "auto";
}

function formatReminder(reminder: { source: string; target: string }): string {
  return `"${reminder.source}" → "${reminder.target}"`;
}

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

  const isAuto = isAutoSource(request.sourceLang);

  const isImageMode = !!request.imageBase64;
  const lines: string[] = [];

  if (isImageMode) {
    lines.push(
      isAuto
        ? `Extract all text from the image and translate it into ${tgt}. Output only the translation.`
        : `Extract all text from the image and translate it from ${src} to ${tgt}. Output only the translation.`,
    );
  } else {
    lines.push(
      isAuto
        ? `You are a professional translator into ${tgt}. Your goal is to accurately convey the meaning and nuances of the original text while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.`
        : `You are a professional ${src} to ${tgt} translator. Your goal is to accurately convey the meaning and nuances of the original ${srcName} text while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.`,
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

  if (request.glossaryReminder && request.glossaryReminder.length > 0) {
    lines.push(`Your translation MUST contain these exact terms: ${request.glossaryReminder.map(formatReminder).join(", ")}.`);
  }

  // Without an explicit instruction the model drops __TLPH_N__ sentinels when fluency suffers.
  const sentinels = isImageMode ? undefined : sentinelTokens(request.source);
  if (sentinels) {
    lines.push(
      `CRITICAL PLACEHOLDER RULE: this source contains exactly ${sentinels.count} placeholder occurrence(s) of the form ${SENTINEL_FORM}. Specifically: ${sentinels.unique.join(", ")}. Your translation MUST contain EXACTLY THESE SAME TOKENS, each as many times as it appears in the source. Even if the resulting sentence sounds awkward, you must include every placeholder. Do not omit, translate, or alter these tokens. Position them naturally in the target sentence.`,
      `EXAMPLES of correct placeholder preservation across languages (the tokens here are only illustrations; use the tokens from the source):`,
      `  Source: "Hello ${EXAMPLE_TOKEN_A}, you have ${EXAMPLE_TOKEN_B} messages"`,
      `  → Spanish: "Hola ${EXAMPLE_TOKEN_A}, tienes ${EXAMPLE_TOKEN_B} mensajes"`,
      `  → Arabic: "مرحبًا ${EXAMPLE_TOKEN_A}، لديك ${EXAMPLE_TOKEN_B} رسالة"`,
      `  → Japanese: "こんにちは ${EXAMPLE_TOKEN_A} さん、${EXAMPLE_TOKEN_B} 件のメッセージがあります"`,
      `Notice that every token from the source appears in each translation as many times as in the source, in a natural position. Apply the same discipline to your translation below.`,
    );
  }

  // Context must come before the translate instruction: everything after it is
  // treated as the text to translate, so snippets there leak into the output.
  if (request.contextSnippets && request.contextSnippets.length > 0) {
    // Snippets are raw 500-char slices, so tag each one to keep their
    // boundaries clear to the model.
    lines.push("Reference material for terminology and style only, inside <reference> tags (do not translate it, do not include it in your output):");
    for (const snippet of request.contextSnippets) {
      lines.push("<reference>", snippet, "</reference>");
    }
    lines.push("");
  }

  if (!isImageMode) {
    lines.push(isAuto ? `Please translate the following text into ${tgtName}:` : `Please translate the following ${srcName} text into ${tgtName}:`);
    // Two blank lines are required by the translategemma prompt template.
    lines.push("");
    lines.push("");
    lines.push(request.source);
  }

  return { prompt: lines.join("\n") };
}

export function buildNaturalPrompt(request: TranslationRequest): string {
  const lines: string[] = [];

  lines.push(
    isAutoSource(request.sourceLang)
      ? `You are a professional translator. Translate the following text to ${request.targetLang}.`
      : `You are a professional translator. Translate the following text from ${request.sourceLang} to ${request.targetLang}.`
  );
  lines.push("Output only the translation, nothing else. Preserve the line breaks and paragraph structure of the source text.");

  if (request.glossaryHits && request.glossaryHits.length > 0) {
    lines.push("\nUse these specific translations for the following terms:");
    for (const hit of request.glossaryHits) {
      lines.push(`- "${hit.entry.sourceTerm}" → "${hit.entry.targetTerm}"`);
    }
  }

  if (request.glossaryReminder && request.glossaryReminder.length > 0) {
    lines.push("\nThe translation must contain these exact terms:");
    for (const reminder of request.glossaryReminder) {
      lines.push(`- ${formatReminder(reminder)}`);
    }
  }

  const sentinels = request.imageBase64 ? undefined : sentinelTokens(request.source);
  if (sentinels) {
    lines.push(
      `\nThe text contains ${sentinels.count} placeholder token(s) of the form ${SENTINEL_FORM}: ${sentinels.unique.join(", ")}. Copy every token into the translation unchanged, as many times as it appears in the text. Do not translate, alter or drop them.`,
    );
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
