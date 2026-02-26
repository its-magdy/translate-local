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
 * Strip all <term ...>...</term> tags from text.
 * - Complete tags: keep inner content (the model should have replaced source with target).
 * - Unclosed tags (model didn't emit </term>): extract the translation attribute value.
 * - Any remaining bare <term ...> opening tags: remove.
 */
export function stripGlossaryTags(text: string): string {
  // Complete tags: <term ...>content</term> → content
  let result = text.replace(/<term[^>]*>(.*?)<\/term>/gs, "$1");
  // Unclosed tags: <term translation="X">... → X (use translation attribute)
  result = result.replace(/<term\s+translation="([^"]*)">[^<]*/g, "$1");
  // Any remaining bare opening tags
  result = result.replace(/<term[^>]*>/g, "");
  return result;
}

/**
 * Normalize whitespace: collapse multiple spaces within lines, preserve newlines, trim.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

function stripCombiningMarks(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
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
  const normalizedTranslated = stripCombiningMarks(translated);
  const uniqueTerms = [...new Set(hits.map((h) => h.entry.sourceTerm))];
  const missingTerms = uniqueTerms.filter((sourceTerm) => {
    const targetTerm = hits.find((h) => h.entry.sourceTerm === sourceTerm)!.entry.targetTerm;
    return !normalizedTranslated.includes(stripCombiningMarks(targetTerm));
  });
  return {
    glossaryCoverage: (uniqueTerms.length - missingTerms.length) / uniqueTerms.length,
    missingTerms,
  };
}
