import { describe, it, expect } from "bun:test";
import { unquoteTerms, elideBeforeTerms, dropDoubledArabicArticle, attachArabicArticle, mergeArabicLam, fixTermAgreement } from "../agreement";

describe("unquoteTerms", () => {
  it("drops quote pairs and em dashes wrapped around a term", () => {
    expect(unquoteTerms("Redémarrez l'« hôte ».", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(unquoteTerms('Redémarrez le "hôte".', ["hôte"])).toBe("Redémarrez le hôte.");
    expect(unquoteTerms("Redémarrez le “hôte”.", ["hôte"])).toBe("Redémarrez le hôte.");
    expect(unquoteTerms("Löschen Sie den „Zweig“.", ["Zweig"])).toBe("Löschen Sie den Zweig.");
    expect(unquoteTerms("Redémarrez le — hôte — maintenant.", ["hôte"])).toBe("Redémarrez le hôte maintenant.");
  });

  it("drops a lone em dash before a term only in French and Italian", () => {
    expect(elideBeforeTerms("Riavvia il —host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(elideBeforeTerms("Riavvia il — host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(elideBeforeTerms("Redémarrez l'—hôte.", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(elideBeforeTerms("—hôte", "fr", ["hôte"])).toBe("hôte");
    expect(elideBeforeTerms("Redémarrez le —serveur.", "fr", ["serveur"])).toBe("Redémarrez le serveur.");
    expect(fixTermAgreement("Riavviare il —host.", "it", ["host"])).toBe("Riavviare l'host.");
    expect(fixTermAgreement("Status — Cleared", "en", ["Cleared"])).toBe("Status — Cleared");
    expect(unquoteTerms("Riavvia il —host.", ["host"])).toBe("Riavvia il —host.");
  });

  it("leaves quotes around other text alone", () => {
    expect(unquoteTerms("Il a dit « bonjour » à l'hôte.", ["hôte"])).toBe("Il a dit « bonjour » à l'hôte.");
    expect(unquoteTerms("« hôte principal »", ["hôte"])).toBe("« hôte principal »");
  });
});

describe("elideBeforeTerms", () => {
  it("elides and contracts French articles before a vowel or mute-h term", () => {
    expect(elideBeforeTerms("Redémarrez le hôte.", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(elideBeforeTerms("Le hôte est en panne.", "fr", ["hôte"])).toBe("L'hôte est en panne.");
    expect(elideBeforeTerms("Connectez-vous au hôte.", "fr", ["hôte"])).toBe("Connectez-vous à l'hôte.");
    expect(elideBeforeTerms("Copiez les fichiers du hôte.", "fr", ["hôte"])).toBe("Copiez les fichiers de l'hôte.");
    expect(elideBeforeTerms("Le nom de hôte", "fr", ["hôte"])).toBe("Le nom d'hôte");
    expect(elideBeforeTerms("Videz la antémémoire.", "fr", ["antémémoire"])).toBe("Videz l'antémémoire.");
    expect(elideBeforeTerms("Redémarrez ce hôte.", "fr", ["hôte"])).toBe("Redémarrez cet hôte.");
    expect(elideBeforeTerms("Videz sa antémémoire.", "fr", ["antémémoire"])).toBe("Videz son antémémoire.");
    expect(elideBeforeTerms("Attendez jusqu'au hôte.", "fr", ["hôte"])).toBe("Attendez jusqu'à l'hôte.");
  });

  it("reuses the typographic apostrophe when the text already has one", () => {
    expect(elideBeforeTerms("Aujourd’hui, redémarrez le hôte.", "fr", ["hôte"])).toBe("Aujourd’hui, redémarrez l’hôte.");
  });

  it("matches the base language of a regional tag", () => {
    expect(elideBeforeTerms("Redémarrez le hôte.", "fr-CA", ["hôte"])).toBe("Redémarrez l'hôte.");
  });

  it("keeps the article before an aspirated h or a consonant", () => {
    expect(elideBeforeTerms("Le héros arrive.", "fr", ["héros"])).toBe("Le héros arrive.");
    expect(elideBeforeTerms("Le hasard décide.", "fr", ["hasard"])).toBe("Le hasard décide.");
    expect(elideBeforeTerms("Le serveur est en panne.", "fr", ["serveur"])).toBe("Le serveur est en panne.");
  });

  it("keeps the article before a y-initial term", () => {
    expect(elideBeforeTerms("Mangez le yaourt.", "fr", ["yaourt"])).toBe("Mangez le yaourt.");
    expect(elideBeforeTerms("Mangia lo yogurt.", "it", ["yogurt"])).toBe("Mangia lo yogurt.");
  });

  it("only touches the word directly before the term", () => {
    expect(elideBeforeTerms("Dis-le hôte.", "fr", ["hôte"])).toBe("Dis-le hôte.");
    expect(elideBeforeTerms("Le serveur et le hôte.", "fr", ["hôte"])).toBe("Le serveur et l'hôte.");
    expect(elideBeforeTerms("Les hôtes", "fr", ["hôte"])).toBe("Les hôtes");
  });

  it("elides Italian articles and contractions", () => {
    expect(elideBeforeTerms("Riavvia il host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(elideBeforeTerms("Lo host è giù.", "it", ["host"])).toBe("L'host è giù.");
    expect(elideBeforeTerms("Accedi al host.", "it", ["host"])).toBe("Accedi all'host.");
    expect(elideBeforeTerms("Copia i file dal host.", "it", ["host"])).toBe("Copia i file dall'host.");
    expect(elideBeforeTerms("Il nome del host", "it", ["host"])).toBe("Il nome dell'host");
    expect(elideBeforeTerms("Riavvia uno host.", "it", ["host"])).toBe("Riavvia un host.");
  });

  it("leaves other languages alone", () => {
    expect(elideBeforeTerms("le hôte", "en", ["hôte"])).toBe("le hôte");
    expect(elideBeforeTerms("Erstellen Sie eine neue Zweig.", "de", ["Zweig"])).toBe("Erstellen Sie eine neue Zweig.");
  });
});

describe("dropDoubledArabicArticle", () => {
  it("drops a detached article before a term that already has one", () => {
    expect(dropDoubledArabicArticle("تم مسح الـ {name} من الـ الكاش.", "ar", ["الكاش"])).toBe("تم مسح الـ {name} من الكاش.");
    expect(dropDoubledArabicArticle("امسح ال الكاش", "ar-EG", ["الكاش"])).toBe("امسح الكاش");
  });

  it("leaves other text, terms and languages alone", () => {
    expect(dropDoubledArabicArticle("امسح الكاش", "ar", ["الكاش"])).toBe("امسح الكاش");
    expect(dropDoubledArabicArticle("ادفع الـ كوميت", "ar", ["كوميت"])).toBe("ادفع الـ كوميت");
    expect(dropDoubledArabicArticle("من الـ الكاش", "fr", ["الكاش"])).toBe("من الـ الكاش");
  });
});

describe("attachArabicArticle", () => {
  it("attaches a detached article, with or without a proclitic, to an Arabic-script term", () => {
    expect(attachArabicArticle("ادفع (الـ كوميت) إلى الفرع البعيد، ثم قم بالـ نشر.", "ar", ["كوميت", "نشر"])).toBe(
      "ادفع (الكوميت) إلى الفرع البعيد، ثم قم بالنشر.",
    );
    expect(attachArabicArticle("أرسله للـ كوميت وبالـــ  نشر", "ar-EG", ["كوميت", "نشر"])).toBe("أرسله للكوميت وبالنشر");
  });

  it("leaves Latin-script terms, ال-initial terms, words ending in ال, bare ال and other languages alone", () => {
    expect(attachArabicArticle("استدعِ الـ API", "ar", ["API"])).toBe("استدعِ الـ API");
    expect(attachArabicArticle("من الـ الكاش", "ar", ["الكاش"])).toBe("من الـ الكاش");
    expect(attachArabicArticle("جمالـ كوميت", "ar", ["كوميت"])).toBe("جمالـ كوميت");
    expect(attachArabicArticle("ادفع ال كوميت", "ar", ["كوميت"])).toBe("ادفع ال كوميت");
    expect(attachArabicArticle("ادفع الـ كوميت", "fr", ["كوميت"])).toBe("ادفع الـ كوميت");
  });

  it("does not join across a line break", () => {
    expect(attachArabicArticle("ادفع الـ\nكوميت", "ar", ["كوميت"])).toBe("ادفع الـ\nكوميت");
  });
});

describe("mergeArabicLam", () => {
  it("merges a detached or doubled ل into an ال-initial term", () => {
    expect(mergeArabicLam("هذه الميزة مفيدة لـ الكاش.", "ar", ["الكاش"])).toBe("هذه الميزة مفيدة للكاش.");
    expect(mergeArabicLam("مخصص للـ التوكن وللـــ  الكاش", "ar-EG", ["التوكن", "الكاش"])).toBe("مخصص للتوكن وللكاش");
    expect(mergeArabicLam("اسم ل الكاش ولالكاش", "ar", ["الكاش"])).toBe("اسم للكاش وللكاش");
  });

  it("merges the article's lam too when the stem starts with ل", () => {
    expect(mergeArabicLam("الدعم للاللغة محدود، لـ اللغة", "ar", ["اللغة"])).toBe("الدعم للغة محدود، للغة");
  });

  it("leaves other words ending in ل, other scripts, line breaks and non-ال terms alone", () => {
    expect(mergeArabicLam("كل الكاش وصل الكاش", "ar", ["الكاش"])).toBe("كل الكاش وصل الكاش");
    expect(mergeArabicLam("لا الكاش ولا غيره", "ar", ["الكاش"])).toBe("لا الكاش ولا غيره");
    expect(mergeArabicLam("لـ\nالكاش", "ar", ["الكاش"])).toBe("لـ\nالكاش");
    expect(mergeArabicLam("لـ الكاش", "fa", ["الكاش"])).toBe("لـ الكاش");
    expect(mergeArabicLam("للـ كوميت", "ar", ["كوميت"])).toBe("للـ كوميت");
  });
});

describe("fixTermAgreement", () => {
  it("unquotes before eliding", () => {
    expect(fixTermAgreement("Redémarrez le « hôte ».", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
  });

  it("is a no-op without terms", () => {
    expect(fixTermAgreement("Redémarrez le « hôte ».", "fr", [])).toBe("Redémarrez le « hôte ».");
  });
});
