import { describe, it, expect } from "bun:test";
import type { GlossaryHit } from "@translate-local/shared/types";
import { TermSet } from "../terms";

// No store, no adapter: a TermSet reads model output as plain strings.

/** A hit for `sourceTerm` at its first occurrence in `source`. */
function hit(source: string, sourceTerm: string, targetTerm: string, forms?: string[]): GlossaryHit {
  const startIndex = source.indexOf(sourceTerm);
  if (startIndex < 0) throw new Error(`${sourceTerm} not in ${source}`);
  return { entry: { id: sourceTerm, sourceTerm, targetTerm, sourceLang: "en", targetLang: "xx", forms }, startIndex, endIndex: startIndex + sourceTerm.length };
}

describe("TermSet", () => {
  const src = "Clear the cache for __TLPH_0__.";
  const cache = hit(src, "cache", "الكاش");
  const sentinel = hit(src, "__TLPH_0__", "__TLPH_0__");

  it("tags the source with every hit, but code-switches and counts only real ones", () => {
    const terms = new TermSet(src, [cache], [sentinel], "ar", false);
    expect(terms.count).toBe(1);
    expect(terms.hits).toEqual([cache, sentinel]);
    expect(terms.taggedSource).toContain('<term translation="الكاش">cache</term>');
    expect(terms.taggedSource).toContain('<term translation="__TLPH_0__">__TLPH_0__</term>');
    // Another script than the source word: the code-switched tag keeps it as an attribute.
    expect(terms.codeSwitchedSource).toContain('<term translation="الكاش" source="cache">الكاش</term>');
    expect(terms.codeSwitchedSource).toContain('<term translation="__TLPH_0__">__TLPH_0__</term>');
  });

  it("without hits sends the source as it is", () => {
    const terms = new TermSet("Save changes", [], [], "fr", false);
    expect(terms.count).toBe(0);
    expect(terms.taggedSource).toBe("Save changes");
    expect(terms.codeSwitchedSource).toBe("Save changes");
  });

  it("reads coverage from real terms only", () => {
    const terms = new TermSet(src, [cache], [sentinel], "ar", false);
    expect(terms.read('امسح <term translation="الكاش">الكاش</term> لـ __TLPH_0__.')).toMatchObject({
      translated: "امسح الكاش لـ __TLPH_0__.", glossaryCoverage: 1, missingTerms: [],
    });
    // The sentinel is not a term: dropping it costs no coverage, missing the term does.
    expect(terms.read("امسح الكاش.")).toMatchObject({ glossaryCoverage: 1, missingTerms: [] });
    expect(terms.read("امسح الذاكرة لـ __TLPH_0__.")).toMatchObject({ glossaryCoverage: 0, missingTerms: ["cache"] });
  });

  it("reports a tag around another word as forced (fix-ups applied), and the model's own form as not", () => {
    const source = "Delete the server.";
    const terms = new TermSet(source, [hit(source, "server", "hôte")], [], "fr", false);
    expect(terms.read('Supprimer le <term translation="hôte">serveur</term>.')).toMatchObject({ translated: "Supprimer l'hôte.", forced: true });
    expect(terms.read('Supprimer les <term translation="hôte">hôtes</term>.')).toMatchObject({ translated: "Supprimer les hôtes.", forced: false });
    expect(terms.read("Supprimer l'hôte.")).toMatchObject({ glossaryCoverage: 1, forced: false });
  });

  it("counts the Arabic ل + ال merge as the term but returns the merged text", () => {
    const source = "The token can work.";
    const terms = new TermSet(source, [hit(source, "token", "التوكن")], [], "ar", false);
    expect(terms.read("يمكن للتوكن أن يعمل.")).toMatchObject({ translated: "يمكن للتوكن أن يعمل.", glossaryCoverage: 1, missingTerms: [] });
  });

  describe("a full stop the source lacks", () => {
    it("drops a sentence-final full stop the model added to a label", () => {
      const TOK = "__TLPH_0__";
      for (const [text, lang, output, expected] of [
        ["Save changes", "fr", "Enregistrer les modifications.", "Enregistrer les modifications"],
        ["Save changes", "fr", "Enregistrer les modifications.\n", "Enregistrer les modifications"],
        ["Clear the cache", "ar", "امسح ذاكرة التخزين المؤقت.", "امسح ذاكرة التخزين المؤقت"],
        ["Save changes", "ja", "変更を保存。", "変更を保存"],
        ["Save changes", "ur", "تبدیلیاں محفوظ کریں۔", "تبدیلیاں محفوظ کریں"],
        ["Save changes", "hi", "परिवर्तन सहेजें।", "परिवर्तन सहेजें"],
        ["Upgrade to version 2", "de", "Auf Version 2 aktualisieren.", "Auf Version 2 aktualisieren"],
        [`Cache size: ${TOK}`, "fr", `Taille du cache : ${TOK}.`, `Taille du cache : ${TOK}`], // ends with a sentinel
        ['Click "Save"', "fr", "Cliquez sur « Enregistrer ».", "Cliquez sur « Enregistrer »"],
        ["Saved. Reload the page", "fr", "Enregistré. Rechargez la page.", "Enregistré. Rechargez la page"],
        ["Remove this server", "ar", "احذف هذا الخادم.‏", "احذف هذا الخادم‏"], // a trailing RLM is kept
        [`Open ${TOK}docs${TOK.replace("0", "1")}`, "fr", `Ouvrez ${TOK}la documentation${TOK.replace("0", "1")}.`, `Ouvrez ${TOK}la documentation${TOK.replace("0", "1")}`],
        ["5 minutes", "de", "5 Minuten.", "5 Minuten"],
      ]) {
        expect(new TermSet(text, [], [], lang, false).read(output).translated).toBe(expected);
      }
    });

    it("keeps end punctuation the source has, and anything but a lone full stop", () => {
      const TOK = "__TLPH_0__";
      for (const [text, output] of [
        ["Save changes.", "Enregistrer les modifications."],
        ["Saved.)", "Enregistré.)"],
        ['Say "Hello."', "Dites « Bonjour »."], // the source's period is inside the quotes
        ["Is it saved?", "Est-ce enregistré ?"],
        ["Save changes", "Enregistrer les modifications !"],
        ["Loading", "Chargement..."],
        ["Loading", "Chargement…"],
        ["Loading", "Chargement.."],
        ["For example", "z. B."], // single-letter abbreviation
        ["For example", "z.B."],
        ["Images, videos and more", "Images, vidéos, etc."],
        ["Images, videos and more", "Bilder, Videos usw."],
        ["Acme", "Acme Inc."],
        ["5 min", "5 Min."],
        ["Order number", "Bestell-Nr."],
        ["For example", "p. ex."],
        ["Settings", "Paramètres"],
        ["Settings", ""],
        // The source's end punctuation sits before sentinels or markdown closers.
        [`Read the ${TOK}docs.${TOK.replace("0", "1")}`, `Lisez la ${TOK}documentation${TOK.replace("0", "1")}.`],
        [`Saved.${TOK}`, `Enregistré${TOK}.`],
        ["**Saved.**", "**Enregistré**."],
        ["_Saved._", "_Enregistré_."],
        ["`npm i`.`", "`npm i`."],
        // Other scripts' end punctuation, and a bidi mark after the source's period.
        ["Պահպանված է։", "Enregistré."],
        ["ተቀምጧል።", "Enregistré."],
        ["သိမ်းပြီး။", "Enregistré."],
        ["រក្សាទុក។", "Enregistré."],
        ["ཉར་ཚགས།", "Enregistré."],
        ["सहेजा गया॥", "Enregistré."],
        ["Really‼", "Vraiment."],
        ["Really⁉", "Vraiment."],
        ["Really‽", "Vraiment."],
        ["Αποθηκεύτηκε;", "Enregistré."],
        ["Τι;", "Quoi."],
        ["تم الحفظ.‏", "Enregistré."],
      ]) {
        expect(new TermSet(text, [], [], "fr", false).read(output).translated).toBe(output);
      }
    });

  });

  it("drops a full stop the source lacks, except in image mode", () => {
    expect(new TermSet("Save changes", [], [], "fr", false).read("Enregistrer les modifications.").translated).toBe("Enregistrer les modifications");
    expect(new TermSet("", [], [], "fr", true).read("Enregistrer les modifications.").translated).toBe("Enregistrer les modifications.");
  });

  it("names the target term of each missing source term", () => {
    const terms = new TermSet(src, [cache], [sentinel], "ar", false);
    expect(terms.reminder(["cache"])).toEqual([{ source: "cache", target: "الكاش" }]);
  });

  describe("tag check", () => {
    const source = "Deploy automatically after every commit.";
    const terms = new TermSet(source, [hit(source, "Deploy", "bereitstellen")], [], "de", false);
    const raw = '<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.';

    it("keeps the word only when the check's output still writes it", () => {
      const candidates = terms.tagCheckCandidates(raw);
      expect(candidates).toEqual(new Map([["bereitstellen", "Automatisch"]]));
      expect(terms.keptWords(candidates, "Automatisch nach jedem Commit bereitstellen.").size).toBe(1);
      expect(terms.keptWords(candidates, "Nach jedem Commit bereitstellen.").size).toBe(0);
    });

    it("a kept word is neither replaced nor forced", () => {
      expect(terms.read(raw)).toMatchObject({ translated: "Bereitstellen nach jedem Commit bereitstellen.", forced: true });
      const kept = terms.keptWords(terms.tagCheckCandidates(raw), "Automatisch nach jedem Commit bereitstellen.");
      expect(terms.read(raw, kept)).toMatchObject({ translated: "Automatisch nach jedem Commit bereitstellen.", glossaryCoverage: 1, forced: false });
    });
  });

  it("names the form a draft has for the repair, split forms as their parts", () => {
    const source = "Please deploy the branch and the cache.";
    const deploy = hit(source, "deploy", "bereitstellen", ["Bereitstellung", "stellen … bereit"]);
    const terms = new TermSet(source, [deploy, hit(source, "branch", "Zweig"), hit(source, "cache", "Zwischenspeicher")], [], "de", false);
    // A missing term is not named.
    expect(terms.repairTerms({ translated: "Bitte stellen Sie den Zweig bereit.", missingTerms: ["cache"] })).toEqual(["stellen", "bereit", "Zweig"]);
    expect(terms.repairTerms({ translated: "Die Bereitstellung des Zweigs.", missingTerms: ["cache"] })).toEqual(["Bereitstellung", "Zweig"]);
  });
});
