import type { TranslationRequest } from "@tl/shared/types";

/**
 * Builds a structured prompt for TranslateGemma models.
 * Uses source_lang/target_lang fields + XML glossary tags.
 */
export function buildStructuredPrompt(request: TranslationRequest): string {
  const lines: string[] = [];

  lines.push(`Translate the following from ${request.sourceLang} to ${request.targetLang}.`);



  if (request.contextSnippets && request.contextSnippets.length > 0) {
    lines.push("\nContext:");
    for (const snippet of request.contextSnippets) {
      lines.push(snippet);
    }
  }

  lines.push(`\nSource: ${request.source}`);
  lines.push("Translation:");

  return lines.join("\n");
}

/**
 * Builds a natural language prompt for generic LLMs (non-TranslateGemma).
 */
export function buildNaturalPrompt(request: TranslationRequest): string {
  const lines: string[] = [];

  lines.push(
    `You are a professional translator. Translate the following text from ${request.sourceLang} to ${request.targetLang}.`
  );
  lines.push("Output only the translation, nothing else.");

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
