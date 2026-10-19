import { describe, test, expect } from "bun:test";
import { TlError, cancelledError } from "@translate-local/shared/errors";
import type { GlossaryHit } from "@translate-local/shared/types";
import { planLeaf, translateLeaf, strictError, isCancelled, type TranslateText } from "../leaf";

const vanilla = { content: "vanilla" as const, translateAll: false };

describe("planLeaf", () => {
  test("keeps FormatJS metadata and skipped values, translates the rest", () => {
    expect(planLeaf("A note", ["greeting", "description"], "greeting.description", { content: "formatjs", translateAll: false }))
      .toEqual({ kind: "keep", reason: "metadata" });
    expect(planLeaf("https://example.com", ["link"], "link", vanilla).kind).toBe("keep");
    expect(planLeaf("https://example.com", ["link"], "link", { ...vanilla, translateAll: true })).toEqual({ kind: "translate", icu: false });
    expect(planLeaf("Hello {name}", ["hi"], "hi", vanilla)).toEqual({ kind: "translate", icu: false });
    expect(planLeaf("{n, plural, one {# file} other {# files}}", ["files"], "files", vanilla)).toEqual({ kind: "translate", icu: true });
  });

  test("refuses ICU branching in an i18next catalog", () => {
    const plan = planLeaf("{n, plural, one {# file} other {# files}}", ["files"], "files", { content: "i18next-plurals", translateAll: false });
    expect(plan).toMatchObject({ kind: "refuse", icuInI18next: true, failure: { message: "ICU MessageFormat in an i18next catalog at files", tag: "FILE_INVALID_FORMAT" } });
  });

  test("refuses ICU that does not parse, naming the parser's error", () => {
    const plan = planLeaf("{n, plural, one {# file}}", ["files"], "files", vanilla);
    expect(plan).toMatchObject({ kind: "refuse", icuInI18next: false });
    if (plan.kind === "refuse") expect(plan.failure.message).toMatch(/^Invalid ICU MessageFormat at files: /);
  });
});

/** Answers each request with the next scripted reply (a string, or an error to throw), recording the texts sent. */
function scripted(...replies: (string | ((text: string) => string) | Error)[]): TranslateText & { sent: string[] } {
  const sent: string[] = [];
  const fn = async (text: string, _hits: GlossaryHit[]): Promise<string> => {
    sent.push(text);
    const reply = replies.shift();
    if (reply === undefined) throw new Error("no scripted reply left");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(text) : reply;
  };
  return Object.assign(fn, { sent });
}

const langs = { icu: false, sourceLang: "en", targetLang: "fr" };

describe("translateLeaf", () => {
  test("masks placeholders and restores them", async () => {
    const translate = scripted((t) => `Bonjour ${t.slice("Hello ".length)}`);
    expect(await translateLeaf("Hello {name}", "hi", langs, translate)).toEqual({ kind: "translated", value: "Bonjour {name}", unhinted: false });
    expect(translate.sent).toEqual(["Hello __TLPH_0__"]);
  });

  test("retries a dropped placeholder and gives up after 10 attempts", async () => {
    const ok = scripted("Bonjour", "Bonjour __TLPH_0__");
    expect(await translateLeaf("Hello {name}", "hi", langs, ok)).toMatchObject({ kind: "translated", value: "Bonjour {name}" });

    const never = scripted(...Array(10).fill("Bonjour"));
    const outcome = await translateLeaf("Hello {name}", "hi", langs, never);
    expect(outcome).toMatchObject({ kind: "failed", failure: { tag: "PLACEHOLDER_MISMATCH" } });
    if (outcome.kind === "failed") expect(outcome.failure.message).toMatch(/^Placeholder mismatch at hi \(attempt 10\/10\)/);
  });

  test("a pipeline error is a failed outcome carrying it; strictError rethrows it", async () => {
    const err = new TlError("ADAPTER_UNAVAILABLE", "Ollama is down", "Start Ollama.");
    const outcome = await translateLeaf("Hello", "hi", langs, scripted(err));
    expect(outcome).toMatchObject({ kind: "failed", failure: { tag: "ADAPTER_UNAVAILABLE", message: "Pipeline failed at hi: Ollama is down" } });
    if (outcome.kind === "failed") expect(strictError(outcome.failure)).toBe(err);

    const plain = await translateLeaf("Hello", "hi", langs, scripted(new Error("boom")));
    expect(plain).toMatchObject({ kind: "failed", failure: { tag: "TRANSLATION_FAILED" } });
  });

  test("a cancelled call is thrown, not a failed outcome", async () => {
    const promise = translateLeaf("Hello", "hi", langs, scripted(cancelledError()));
    await expect(promise).rejects.toMatchObject({ tag: "CANCELLED" });
    expect(isCancelled(await promise.catch((e) => e))).toBe(true);
  });

  test("a plural form is sent with its sample count, which is swapped back", async () => {
    const translate = scripted("3 fichiers");
    const outcome = await translateLeaf("{{count}} files", "files_other", { ...langs, hint: { value: 3, exact: false } }, translate);
    expect(outcome).toEqual({ kind: "translated", value: "{{count}} fichiers", unhinted: false });
    expect(translate.sent).toEqual(["3 files"]);
  });

  test("a plural form whose sample the model drops falls back to the plain text and is unhinted", async () => {
    const translate = scripted("des fichiers", "des fichiers", "des fichiers", "__TLPH_0__ fichiers");
    const outcome = await translateLeaf("{{count}} files", "files_other", { ...langs, hint: { value: 3, exact: false } }, translate);
    expect(outcome).toEqual({ kind: "translated", value: "{{count}} fichiers", unhinted: true });
    expect(translate.sent).toEqual(["3 files", "3 files", "3 files", "__TLPH_0__ files"]);
  });

  test("translates each ICU branch as its own unit", async () => {
    const fr = (t: string) => t.replace("file", "fichier");
    const translate = scripted(fr, fr);
    const outcome = await translateLeaf("{n, plural, one {# file} other {# files}}", "files", { ...langs, icu: true }, translate);
    expect(outcome).toEqual({ kind: "translated", value: "{n, plural, one {# fichier} other {# fichiers}}", unhinted: false });
    // Each branch carries a sample count for its category.
    expect(translate.sent).toEqual(["1 file", "2 files"]);
  });
});

describe("strictError", () => {
  test("builds a TlError with the failure's tag, message and hint", () => {
    const err = strictError({ message: "Invalid ICU MessageFormat at x: bad", tag: "FILE_INVALID_FORMAT", hint: "Fix it." });
    expect(err).toBeInstanceOf(TlError);
    expect(err).toMatchObject({ tag: "FILE_INVALID_FORMAT", message: "Invalid ICU MessageFormat at x: bad", hint: "Fix it." });
  });
});
