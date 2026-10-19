import type { GlossaryHit } from "@translate-local/shared/types";
import { injectGlossaryTags, stripGlossaryTags, keptTermForm, normalizeWhitespace, computeGlossaryCoverage, foundForm, formParts, contiguousForms, tagCheckCandidates, checkKeepsWord, driftCandidates, checkWritesDriftedWord } from "@translate-local/shared/utils/text";
import { fixTermAgreement, splitArabicArticles } from "./agreement";
import { dropAddedFullStop } from "./punctuation";

// A term tag in model output, closed or not: [, translation attribute, inner text].
// Doesn't match code-switched tags with a source attribute; that attempt counts as forced anyway.
const OUTPUT_TAG_RE = /<term\s+translation="([^"]*)">([^<]*)/g;

/** Target term → the word inside its tag that the tag strip keeps (see the tag check). */
export type KeptWords = ReadonlyMap<string, string>;

/** One model output after the tag strip and fix-ups, with its coverage. */
export interface Reading {
  translated: string;
  glossaryCoverage: number;
  missingTerms: string[];
  /**
   * The raw output has a term tag around a different word, which the tag strip
   * replaced with the term: the words around it may still agree with the
   * model's word. A tag around the model's own form of the term or of one of
   * its forms (keptTermForm), or around a kept word, is no substitution.
   */
  forced: boolean;
}

/**
 * The glossary terms of one source text: what to send the model, and how to
 * read what it sends back. Built once per pipeline call from the matched hits.
 *
 * `hits` are real glossary hits; `extraHits` (file mode's placeholder
 * sentinels) are tagged in the source like them but take no part in coverage,
 * reminders, the code-switched retry, fix-ups, the tag check or the repair.
 */
export class TermSet {
  /** Distinct glossary terms in the source (TranslationResult.glossaryTerms). */
  readonly count: number;
  /** Real and extra hits, sorted by position: what the source is tagged with. */
  readonly hits: GlossaryHit[];
  readonly taggedSource: string;
  /**
   * The last glossary retry's source: each real term's target in place of its
   * source word (the tag check reuses it).
   */
  readonly codeSwitchedSource: string;

  private readonly realHits: GlossaryHit[];
  private readonly targetTerms: string[];
  /** Each target term's other forms, which the tag strip keeps like the term. */
  private readonly forms = new Map<string, string[]>();
  /** Target terms and one-piece forms: the fix-ups and the Arabic coverage split apply to both. */
  private readonly agreementTerms: string[];

  constructor(
    private readonly source: string,
    hits: GlossaryHit[],
    extraHits: GlossaryHit[],
    private readonly targetLang: string,
    private readonly imageMode: boolean,
  ) {
    this.realHits = hits;
    this.hits = [...hits, ...extraHits].sort((a, b) => a.startIndex - b.startIndex);
    this.taggedSource = this.hits.length > 0 ? injectGlossaryTags(source, this.hits) : source;
    this.codeSwitchedSource = hits.length > 0 ? injectGlossaryTags(source, this.hits, hits) : this.taggedSource;
    // Real hits only: placeholder sentinels need no agreement fix-up.
    this.targetTerms = [...new Set(hits.map((h) => h.entry.targetTerm))];
    for (const { entry } of hits) this.forms.set(entry.targetTerm, [...new Set([...(this.forms.get(entry.targetTerm) ?? []), ...(entry.forms ?? [])])]);
    this.agreementTerms = [...new Set([...this.targetTerms, ...contiguousForms([...this.forms.values()].flat())])];
    this.count = new Set(hits.map((h) => h.entry.sourceTerm)).size;
  }

  /** A raw model output after the tag strip (keeping the `kept` words) and fix-ups, with its coverage. */
  read(raw: string, kept?: KeptWords): Reading {
    const postprocessed = fixTermAgreement(normalizeWhitespace(stripGlossaryTags(raw, this.forms, kept)), this.targetLang, this.agreementTerms);
    const translated = this.imageMode ? postprocessed : dropAddedFullStop(postprocessed, this.source, this.agreementTerms);
    return { translated, ...this.coverage(translated), forced: substitutesTerm(raw, this.targetTerms, this.forms, kept) };
  }

  /** The glossary coverage of a postprocessed translation. */
  coverage(translated: string): { glossaryCoverage: number; missingTerms: string[] } {
    return computeGlossaryCoverage(this.realHits, splitArabicArticles(translated, this.targetLang, this.agreementTerms));
  }

  /** The target term of each missing source term, for a glossary retry's reminder. */
  reminder(missingTerms: string[]): { source: string; target: string }[] {
    return missingTerms.map((term) => ({
      source: term,
      target: this.realHits.find((h) => h.entry.sourceTerm === term)!.entry.targetTerm,
    }));
  }

  /** Terms tagged around another word in `raw` that the tag check could keep (see tagCheckCandidates). */
  tagCheckCandidates(raw: string): KeptWords {
    return tagCheckCandidates(raw, this.realHits, this.forms);
  }

  /** The candidates whose word the check's output (for the code-switched source) still writes. */
  keptWords(candidates: KeptWords, checkOutput: string): KeptWords {
    return new Map([...candidates].filter(([term, inner]) => checkKeepsWord(checkOutput, term, inner, this.forms)));
  }

  /** Terms tagged around a span of other words in `raw`, with no occurrence outside, that the drift check decides (see driftCandidates). */
  driftCandidates(raw: string): KeptWords {
    return driftCandidates(raw, this.realHits, this.forms);
  }

  /** Whether the check's output (for the code-switched source) still writes a candidate's drifted span. */
  drifted(candidates: KeptWords, checkOutput: string): boolean {
    return [...candidates].some(([term, inner]) => checkWritesDriftedWord(checkOutput, term, inner, this.forms));
  }

  /** The form of each covered term the draft has (a split form's parts), which an agreement repair must keep. */
  repairTerms(draft: Pick<Reading, "translated" | "missingTerms">): string[] {
    return [...new Set(this.realHits
      .filter((h) => !draft.missingTerms.includes(h.entry.sourceTerm))
      .flatMap((h) => {
        const found = foundForm(draft.translated, h.entry.targetTerm, this.forms.get(h.entry.targetTerm)) ?? h.entry.targetTerm;
        return found === h.entry.targetTerm ? [found] : formParts(found);
      }))];
  }
}

/**
 * Whether the raw output has a term tag for one of `targetTerms` around a
 * different word, which stripGlossaryTags then replaces with the term. A
 * complete tag around the model's own form of the term or of one of its
 * `forms` (keptTermForm), or around the word `kept` maps the term to (the tag
 * check), keeps that word, so it is no substitution.
 */
function substitutesTerm(raw: string, targetTerms: string[], forms: ReadonlyMap<string, readonly string[]>, kept?: ReadonlyMap<string, string>): boolean {
  for (const match of raw.matchAll(OUTPUT_TAG_RE)) {
    const [tag, attr, inner] = match;
    // The term exactly as the strip writes it (attribute unescaped).
    const term = stripGlossaryTags(`<term translation="${attr}"></term>`);
    if (!targetTerms.includes(term)) continue;
    const closed = raw.startsWith("</term>", match.index + tag.length);
    if (closed ? keptTermForm(inner, term, forms.get(term)) === undefined && kept?.get(term) !== inner : inner.trim() !== term) return true;
  }
  return false;
}
