import { langFallbackChain } from "@translate-local/shared/utils/language";

/**
 * Deterministic fix-ups the pipeline applies around glossary target terms
 * after tag stripping (#108). The model often keeps the article it would
 * use for its own word ("le serveur" → "le hôte") or quotes the forced term.
 * Only the text directly around a target term is touched.
 */

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quote pairs (and em dashes) the model wraps around a substituted term. */
const QUOTE_PAIRS: [string, string][] = [["«", "»"], ['"', '"'], ["“", "”"], ["„", "“"], ["—", "—"]];

/** Drop quotes or em dashes wrapped directly around a term (`« hôte »` → `hôte`). */
export function unquoteTerms(text: string, terms: string[]): string {
  for (const term of terms) {
    const t = escapeRegExp(term);
    for (const [open, close] of QUOTE_PAIRS) {
      text = text.replace(new RegExp(`${escapeRegExp(open)}\\s*(${t})\\s*${escapeRegExp(close)}`, "gu"), "$1");
    }
  }
  return text;
}

/** French words starting with an aspirated h, which takes no elision ("le héros"). */
const FR_ASPIRATED_H = new Set([
  "hache", "haine", "hall", "halte", "hamac", "hameau", "hamburger", "hanche", "handicap", "hangar",
  "hareng", "haricot", "harpe", "hasard", "hâte", "haut", "hauteur", "hausse", "hérisson", "hernie",
  "héron", "héros", "hêtre", "hibou", "hiérarchie", "hockey", "homard", "honte", "hoquet", "hors",
  "housse", "houx", "hublot", "huit", "hutte",
]);

/** [words before the term (alternation), replacement without the apostrophe or space]. */
type Rule = [words: string, replacement: string, apostrophe: boolean];

const FR_RULES: Rule[] = [
  ["le|la", "l", true],
  ["au", "à l", true],
  ["du", "de l", true],
  ["de", "d", true],
  ["que", "qu", true],
  ["jusque", "jusqu", true],
  ["ce", "cet", false],
  ["ma", "mon", false],
  ["ta", "ton", false],
  ["sa", "son", false],
  ["beau", "bel", false],
  ["nouveau", "nouvel", false],
];

const IT_RULES: Rule[] = [
  ["il|lo|la", "l", true],
  ["del|dello|della", "dell", true],
  ["al|allo|alla", "all", true],
  ["dal|dallo|dalla", "dall", true],
  ["nel|nello|nella", "nell", true],
  ["sul|sullo|sulla", "sull", true],
  ["uno", "un", false],
  ["una", "un", true],
  ["quello|quella", "quell", true],
  ["questo|questa", "quest", true],
  ["bello|bella", "bell", true],
];

// No y: "le yaourt", "lo yogurt".
const VOWEL_OR_H_RE = /^[aeiouàâäáéèêëíìîïóòôöúùûüœæh]/i;

function takesElision(term: string, lang: "fr" | "it"): boolean {
  if (!VOWEL_OR_H_RE.test(term)) return false;
  if (lang === "fr") {
    const firstWord = term.normalize("NFC").toLowerCase().split(/[\s-]/)[0];
    if (FR_ASPIRATED_H.has(firstWord)) return false;
  }
  return true;
}

/**
 * French/Italian elision and contraction before a term starting with a vowel
 * or mute h: fr `le hôte` → `l'hôte`, `au hôte` → `à l'hôte`, `ce hôte` →
 * `cet hôte`; it `il host` → `l'host`. A lone em dash right before the term
 * is dropped first (`il —host` → `l'host`). Other target languages are returned as is.
 */
export function elideBeforeTerms(text: string, targetLang: string, terms: string[]): string {
  const base = langFallbackChain(targetLang).at(-1);
  if (base !== "fr" && base !== "it") return text;
  const rules = base === "fr" ? FR_RULES : IT_RULES;
  const ap = text.includes("’") ? "’" : "'";
  const matchCase = (orig: string, rep: string): string => (orig[0] !== orig[0].toLowerCase() ? rep[0].toUpperCase() + rep.slice(1) : rep);
  for (const term of terms) {
    const t = escapeRegExp(term);
    // A lone em dash before the term (`il —host`) would block the rules below.
    text = text.replace(new RegExp(`(['’])?\\s*—\\s*(?=${t})`, "gu"), (_m, a: string | undefined, offset: number) => a ?? (offset === 0 ? "" : " "));
    if (!takesElision(term, base)) continue;
    for (const [words, replacement, apostrophe] of rules) {
      // No letter or hyphen before the word ("dis-le hôte" stays); an apostrophe is fine ("jusqu'au").
      const re = new RegExp(`(?<![\\p{L}\\p{M}-])(${words})\\s+(?=${t})`, "giu");
      text = text.replace(re, (_m, word: string) => matchCase(word, replacement) + (apostrophe ? ap : " "));
    }
  }
  return text;
}

/**
 * Arabic: drop a detached article (`الـ` / `ال`) the model puts before a term
 * that already starts with `ال`: `من الـ الكاش` → `من الكاش`.
 */
export function dropDoubledArabicArticle(text: string, targetLang: string, terms: string[]): string {
  if (langFallbackChain(targetLang).at(-1) !== "ar") return text;
  for (const term of terms) {
    if (!term.startsWith("ال")) continue;
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{M}])الـ*\\s+(?=${escapeRegExp(term)})`, "gu"), "");
  }
  return text;
}

/**
 * Arabic: attach a detached article (`الـ`, after an optional proclitic) to an
 * Arabic-script term without one: `ادفع الـ كوميت` → `ادفع الكوميت`,
 * `قم بالـ نشر` → `قم بالنشر`, `للـ كوميت` → `للكوميت`. The detached form is
 * for foreign-script words, so a Latin-script term (`الـ API`) keeps it.
 */
export function attachArabicArticle(text: string, targetLang: string, terms: string[]): string {
  if (langFallbackChain(targetLang).at(-1) !== "ar") return text;
  for (const term of terms) {
    if (term.startsWith("ال") || !/^\p{Script=Arabic}/u.test(term)) continue;
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{M}])([وف]?[بك]?ال|[وف]?لل)ـ+[^\\S\\n]+(?=${escapeRegExp(term)})`, "gu"), "$1");
  }
  return text;
}

/**
 * The preposition `ل` merged with an `ال`-initial term, as Arabic writes it:
 * `للكاش`, and `للغة` when the stem starts with `ل` (the article's lam merges too).
 */
export function arabicLamMerge(term: string): string {
  const stem = term.slice(2);
  return (stem.startsWith("ل") ? "ل" : "لل") + stem;
}

/**
 * Arabic: merge a detached or doubled `ل` (after an optional و/ف) into an
 * `ال`-initial term: `لـ الكاش` / `للـ الكاش` / `لالكاش` → `للكاش`,
 * `للاللغة` → `للغة`. Coverage counts the merge as the term (see
 * `splitArabicArticles()` in pipeline.ts).
 */
export function mergeArabicLam(text: string, targetLang: string, terms: string[]): string {
  if (langFallbackChain(targetLang).at(-1) !== "ar") return text;
  for (const term of terms) {
    if (!term.startsWith("ال")) continue;
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{M}])([وف]?)لل?ـ*[^\\S\\n]*${escapeRegExp(term)}`, "gu"), `$1${arabicLamMerge(term)}`);
  }
  return text;
}

/** Apply every fix-up around the given glossary target terms. */
export function fixTermAgreement(text: string, targetLang: string, terms: string[]): string {
  if (terms.length === 0) return text;
  const unquoted = unquoteTerms(text, terms);
  const elided = elideBeforeTerms(unquoted, targetLang, terms);
  const merged = mergeArabicLam(dropDoubledArabicArticle(elided, targetLang, terms), targetLang, terms);
  return attachArabicArticle(merged, targetLang, terms);
}
