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

function unescapeAttr(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/**
 * Strip all <term ...>...</term> tags from text.
 * - Complete tags: replace with the translation attribute value (what injectGlossaryTags wrote).
 *   The model sometimes echoes the whole tag with its own word inside; the glossary requires the
 *   attribute's term, not that word. Tags without a translation attribute keep their inner content.
 * - Unclosed tags (model didn't emit </term>): extract the translation attribute value.
 * - Any remaining bare <term ...> opening tags: remove.
 */
export function stripGlossaryTags(text: string): string {
  // Complete tags: <term translation="X">content</term> → X
  let result = removeTermTags(text, true);
  // Unclosed tags: <term translation="X">... → X (use translation attribute)
  result = result.replace(/<term\s+translation="([^"]*)">[^<]*/g, (_m, attr: string) => unescapeAttr(attr));
  // Any remaining bare opening tags
  result = removeTermTags(result, false);
  return result;
}

/**
 * Same result as replacing /<term[^>]*>(.*?)<\/term>/gs with the opening tag's
 * translation attribute (else "$1") (withClose) or /<term[^>]*>/g with "" (!withClose),
 * in linear time. Those regexes rescan
 * to the end of the text from every unclosed "<term", which is quadratic.
 */
function removeTermTags(text: string, withClose: boolean): string {
  let result = "";
  let cursor = 0;

  for (;;) {
    const open = text.indexOf("<term", cursor);
    if (open === -1) break;
    const openEnd = text.indexOf(">", open);
    if (openEnd === -1) break;
    let next = openEnd + 1;
    let inner = "";
    if (withClose) {
      const close = text.indexOf("</term>", next);
      if (close === -1) break;
      inner = text.slice(next, close);
      const attr = /\btranslation="([^"]*)"/.exec(text.slice(open, openEnd));
      if (attr) inner = unescapeAttr(attr[1]);
      next = close + "</term>".length;
    }
    result += text.slice(cursor, open) + inner;
    cursor = next;
  }

  result += text.slice(cursor);
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
