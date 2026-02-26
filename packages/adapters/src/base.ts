import type { TranslationRequest } from "@tl/shared/types";

/**
 * Builds a structured prompt for TranslateGemma models.
 * Returns { prompt, system } where system carries glossary instructions
 * so the model doesn't echo them as part of the translation.
 */
export function buildStructuredPrompt(request: TranslationRequest): { prompt: string; system?: string } {
  const lines: string[] = [];

  lines.push(`Translate the following text from ${request.sourceLang} to ${request.targetLang}.`);
  lines.push("Preserve the line breaks and paragraph structure of the source text.");

  if (request.contextSnippets && request.contextSnippets.length > 0) {
    lines.push("\nContext:");
    for (const snippet of request.contextSnippets) {
      lines.push(snippet);
    }
  }

  lines.push(request.source);

  const system =
    request.glossaryHits && request.glossaryHits.length > 0
      ? "Preserve terms marked with <term> tags and use their specified translations."
      : undefined;

  return { prompt: lines.join("\n"), system };
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
