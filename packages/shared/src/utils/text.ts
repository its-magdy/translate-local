import type { GlossaryHit } from "../types";

/**
 * Inject glossary XML tags into source text for matched terms.
 * Hits must be sorted by startIndex ascending and non-overlapping.
 */
export function injectGlossaryTags(text: string, hits: GlossaryHit[]): string {
  if (hits.length === 0) return text;

  let result = "";
  let cursor = 0;

  for (const hit of hits) {
    result += text.slice(cursor, hit.startIndex);
    const sourcePart = text.slice(hit.startIndex, hit.endIndex);
    result += `<term translation="${hit.entry.targetTerm}">${sourcePart}</term>`;
    cursor = hit.endIndex;
  }

  result += text.slice(cursor);
  return result;
}

/**
 * Strip all <term ...>...</term> tags from text, keeping only the inner content.
 */
export function stripGlossaryTags(text: string): string {
  return text.replace(/<term[^>]*>(.*?)<\/term>/g, "$1");
}

/**
 * Normalize whitespace: collapse multiple spaces/newlines to single space, trim.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
