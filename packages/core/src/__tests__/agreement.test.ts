import { describe, it, expect } from "bun:test";
import { fixTermAgreement } from "../agreement";

// Every fix-up is reached through fixTermAgreement, as the Term Set calls it.

describe("unquoteTerms", () => {
  it("drops quote pairs and em dashes wrapped around a term", () => {
    expect(fixTermAgreement("Redémarrez l'« hôte ».", "en", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(fixTermAgreement('Redémarrez le "hôte".', "en", ["hôte"])).toBe("Redémarrez le hôte.");
    expect(fixTermAgreement("Redémarrez le “hôte”.", "en", ["hôte"])).toBe("Redémarrez le hôte.");
    expect(fixTermAgreement("Löschen Sie den „Zweig“.", "en", ["Zweig"])).toBe("Löschen Sie den Zweig.");
    expect(fixTermAgreement("Redémarrez le — hôte — maintenant.", "en", ["hôte"])).toBe("Redémarrez le hôte maintenant.");
  });

  it("drops a lone em dash before a term only in French and Italian", () => {
    expect(fixTermAgreement("Riavvia il —host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(fixTermAgreement("Riavvia il — host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(fixTermAgreement("Redémarrez l'—hôte.", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(fixTermAgreement("—hôte", "fr", ["hôte"])).toBe("hôte");
    expect(fixTermAgreement("Redémarrez le —serveur.", "fr", ["serveur"])).toBe("Redémarrez le serveur.");
    expect(fixTermAgreement("Riavviare il —host.", "it", ["host"])).toBe("Riavviare l'host.");
    expect(fixTermAgreement("Status — Cleared", "en", ["Cleared"])).toBe("Status — Cleared");
    expect(fixTermAgreement("Riavvia il —host.", "en", ["host"])).toBe("Riavvia il —host.");
  });

  it("leaves quotes around other text alone", () => {
    expect(fixTermAgreement("Il a dit « bonjour » à l'hôte.", "en", ["hôte"])).toBe("Il a dit « bonjour » à l'hôte.");
    expect(fixTermAgreement("« hôte principal »", "en", ["hôte"])).toBe("« hôte principal »");
  });
});

describe("elideBeforeTerms", () => {
  it("elides and contracts French articles before a vowel or mute-h term", () => {
    expect(fixTermAgreement("Redémarrez le hôte.", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
    expect(fixTermAgreement("Le hôte est en panne.", "fr", ["hôte"])).toBe("L'hôte est en panne.");
    expect(fixTermAgreement("Connectez-vous au hôte.", "fr", ["hôte"])).toBe("Connectez-vous à l'hôte.");
    expect(fixTermAgreement("Copiez les fichiers du hôte.", "fr", ["hôte"])).toBe("Copiez les fichiers de l'hôte.");
    expect(fixTermAgreement("Le nom de hôte", "fr", ["hôte"])).toBe("Le nom d'hôte");
    expect(fixTermAgreement("Videz la antémémoire.", "fr", ["antémémoire"])).toBe("Videz l'antémémoire.");
    expect(fixTermAgreement("Redémarrez ce hôte.", "fr", ["hôte"])).toBe("Redémarrez cet hôte.");
    expect(fixTermAgreement("Videz sa antémémoire.", "fr", ["antémémoire"])).toBe("Videz son antémémoire.");
    expect(fixTermAgreement("Attendez jusqu'au hôte.", "fr", ["hôte"])).toBe("Attendez jusqu'à l'hôte.");
  });

  it("reuses the typographic apostrophe when the text already has one", () => {
    expect(fixTermAgreement("Aujourd’hui, redémarrez le hôte.", "fr", ["hôte"])).toBe("Aujourd’hui, redémarrez l’hôte.");
  });

  it("matches the base language of a regional tag", () => {
    expect(fixTermAgreement("Redémarrez le hôte.", "fr-CA", ["hôte"])).toBe("Redémarrez l'hôte.");
  });

  it("keeps the article before an aspirated h or a consonant", () => {
    expect(fixTermAgreement("Le héros arrive.", "fr", ["héros"])).toBe("Le héros arrive.");
    expect(fixTermAgreement("Le hasard décide.", "fr", ["hasard"])).toBe("Le hasard décide.");
    expect(fixTermAgreement("Le serveur est en panne.", "fr", ["serveur"])).toBe("Le serveur est en panne.");
  });

  it("keeps the article before a y-initial term", () => {
    expect(fixTermAgreement("Mangez le yaourt.", "fr", ["yaourt"])).toBe("Mangez le yaourt.");
    expect(fixTermAgreement("Mangia lo yogurt.", "it", ["yogurt"])).toBe("Mangia lo yogurt.");
  });

  it("only touches the word directly before the term", () => {
    expect(fixTermAgreement("Dis-le hôte.", "fr", ["hôte"])).toBe("Dis-le hôte.");
    expect(fixTermAgreement("Le serveur et le hôte.", "fr", ["hôte"])).toBe("Le serveur et l'hôte.");
    expect(fixTermAgreement("Les hôtes", "fr", ["hôte"])).toBe("Les hôtes");
  });

  it("elides Italian articles and contractions", () => {
    expect(fixTermAgreement("Riavvia il host.", "it", ["host"])).toBe("Riavvia l'host.");
    expect(fixTermAgreement("Lo host è giù.", "it", ["host"])).toBe("L'host è giù.");
    expect(fixTermAgreement("Accedi al host.", "it", ["host"])).toBe("Accedi all'host.");
    expect(fixTermAgreement("Copia i file dal host.", "it", ["host"])).toBe("Copia i file dall'host.");
    expect(fixTermAgreement("Il nome del host", "it", ["host"])).toBe("Il nome dell'host");
    expect(fixTermAgreement("Riavvia uno host.", "it", ["host"])).toBe("Riavvia un host.");
  });

  it("leaves other languages alone", () => {
    expect(fixTermAgreement("le hôte", "en", ["hôte"])).toBe("le hôte");
    expect(fixTermAgreement("Erstellen Sie eine neue Zweig.", "de", ["Zweig"])).toBe("Erstellen Sie eine neue Zweig.");
  });
});

describe("dropDoubledArabicArticle", () => {
  it("drops a detached article before a term that already has one", () => {
    expect(fixTermAgreement("تم مسح الـ {name} من الـ الكاش.", "ar", ["الكاش"])).toBe("تم مسح الـ {name} من الكاش.");
    expect(fixTermAgreement("امسح ال الكاش", "ar-EG", ["الكاش"])).toBe("امسح الكاش");
  });

  it("leaves other text, terms and languages alone", () => {
    expect(fixTermAgreement("امسح الكاش", "ar", ["الكاش"])).toBe("امسح الكاش");
    // Not a doubled article; attaching it is another fix-up's job.
    expect(fixTermAgreement("ادفع الـ كوميت", "ar", ["كوميت"])).toBe("ادفع الكوميت");
    expect(fixTermAgreement("من الـ الكاش", "fr", ["الكاش"])).toBe("من الـ الكاش");
  });
});

describe("attachArabicArticle", () => {
  it("attaches a detached article, with or without a proclitic, to an Arabic-script term", () => {
    expect(fixTermAgreement("ادفع (الـ كوميت) إلى الفرع البعيد، ثم قم بالـ نشر.", "ar", ["كوميت", "نشر"])).toBe(
      "ادفع (الكوميت) إلى الفرع البعيد، ثم قم بالنشر.",
    );
    expect(fixTermAgreement("أرسله للـ كوميت وبالـــ  نشر", "ar-EG", ["كوميت", "نشر"])).toBe("أرسله للكوميت وبالنشر");
  });

  it("leaves Latin-script terms, ال-initial terms, words ending in ال, bare ال and other languages alone", () => {
    expect(fixTermAgreement("استدعِ الـ API", "ar", ["API"])).toBe("استدعِ الـ API");
    // An ال-initial term isn't attached to; the doubled article is dropped instead.
    expect(fixTermAgreement("من الـ الكاش", "ar", ["الكاش"])).toBe("من الكاش");
    expect(fixTermAgreement("جمالـ كوميت", "ar", ["كوميت"])).toBe("جمالـ كوميت");
    expect(fixTermAgreement("ادفع ال كوميت", "ar", ["كوميت"])).toBe("ادفع ال كوميت");
    expect(fixTermAgreement("ادفع الـ كوميت", "fr", ["كوميت"])).toBe("ادفع الـ كوميت");
  });

  it("does not join across a line break", () => {
    expect(fixTermAgreement("ادفع الـ\nكوميت", "ar", ["كوميت"])).toBe("ادفع الـ\nكوميت");
  });
});

describe("mergeArabicLam", () => {
  it("merges a detached or doubled ل into an ال-initial term", () => {
    expect(fixTermAgreement("هذه الميزة مفيدة لـ الكاش.", "ar", ["الكاش"])).toBe("هذه الميزة مفيدة للكاش.");
    expect(fixTermAgreement("مخصص للـ التوكن وللـــ  الكاش", "ar-EG", ["التوكن", "الكاش"])).toBe("مخصص للتوكن وللكاش");
    expect(fixTermAgreement("اسم ل الكاش ولالكاش", "ar", ["الكاش"])).toBe("اسم للكاش وللكاش");
  });

  it("merges the article's lam too when the stem starts with ل", () => {
    expect(fixTermAgreement("الدعم للاللغة محدود، لـ اللغة", "ar", ["اللغة"])).toBe("الدعم للغة محدود، للغة");
  });

  it("leaves other words ending in ل, other scripts, line breaks and non-ال terms alone", () => {
    expect(fixTermAgreement("كل الكاش وصل الكاش", "ar", ["الكاش"])).toBe("كل الكاش وصل الكاش");
    expect(fixTermAgreement("لا الكاش ولا غيره", "ar", ["الكاش"])).toBe("لا الكاش ولا غيره");
    expect(fixTermAgreement("لـ\nالكاش", "ar", ["الكاش"])).toBe("لـ\nالكاش");
    expect(fixTermAgreement("لـ الكاش", "fa", ["الكاش"])).toBe("لـ الكاش");
    // Not an ال-initial term, so no lam merge; the detached article is attached instead.
    expect(fixTermAgreement("للـ كوميت", "ar", ["كوميت"])).toBe("للكوميت");
  });
});

describe("fixTermAgreement", () => {
  it("unquotes before eliding", () => {
    expect(fixTermAgreement("Redémarrez le « hôte ».", "fr", ["hôte"])).toBe("Redémarrez l'hôte.");
  });

  it("also unquotes and elides before the term written capitalized", () => {
    expect(fixTermAgreement("« Hôte » : détails", "fr", ["hôte"])).toBe("Hôte : détails");
    expect(fixTermAgreement("Voir le Hôte", "fr", ["hôte"])).toBe("Voir l'Hôte");
    expect(fixTermAgreement("« IOS » prêt", "fr", ["iOS"])).toBe("« IOS » prêt");
  });

  it("is a no-op without terms", () => {
    expect(fixTermAgreement("Redémarrez le « hôte ».", "fr", [])).toBe("Redémarrez le « hôte ».");
  });
});
