import type { GlossaryHit } from "../types";
import { TlError } from "../errors";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeContent(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inject glossary XML tags into source text for matched terms.
 * Hits must be sorted by startIndex ascending and non-overlapping.
 * Throws if hits are out-of-order or overlapping.
 */
export function injectGlossaryTags(text: string, hits: GlossaryHit[]): string {
  if (hits.length === 0) return text;

  for (let i = 1; i < hits.length; i++) {
    if (hits[i].startIndex < hits[i - 1].endIndex) {
      throw new TlError("INVALID_INPUT", "injectGlossaryTags: hits must be sorted by startIndex and non-overlapping", "Sort hits by startIndex and ensure they do not overlap before calling injectGlossaryTags");
    }
  }

  let result = "";
  let cursor = 0;

  for (const hit of hits) {
    result += text.slice(cursor, hit.startIndex);
    const sourcePart = text.slice(hit.startIndex, hit.endIndex);
    result += `<term translation="${escapeAttr(hit.entry.targetTerm)}">${escapeContent(sourcePart)}</term>`;
    cursor = hit.endIndex;
  }

  result += text.slice(cursor);
  return result;
}

/**
 * Strip all <term ...>...</term> tags from text, keeping only the inner content.
 */
export function stripGlossaryTags(text: string): string {
  return text.replace(/<term[^>]*>(.*?)<\/term>/gs, "$1");
}

/**
 * Normalize whitespace: collapse multiple spaces/newlines to single space, trim.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Compute glossary coverage ratio and list of missing source terms.
 * Returns { glossaryCoverage: 1, missingTerms: [] } when there are no hits.
 */
export function computeGlossaryCoverage(
  hits: GlossaryHit[],
  translated: string
): { glossaryCoverage: number; missingTerms: string[] } {
  if (hits.length === 0) return { glossaryCoverage: 1, missingTerms: [] };
  const missingTerms = hits
    .filter((h) => !translated.includes(h.entry.targetTerm))
    .map((h) => h.entry.sourceTerm);
  return {
    glossaryCoverage: (hits.length - missingTerms.length) / hits.length,
    missingTerms,
  };
}
