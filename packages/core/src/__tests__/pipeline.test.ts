import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runPipeline } from "../pipeline";
import { GlossaryStore } from "../glossary";
import { MockAdapter } from "@translate-local/adapters/mock";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TlError } from "@translate-local/shared/errors";

// MockAdapter + temp SQLite only — no Ollama needed, so this suite runs by
// default. Gating it behind TEST_INTEGRATION hid every pipeline regression
// (retries, streaming contract, image mode) from plain `bun run test`.
describe("runPipeline", () => {
  let dbPath: string;
  let store: GlossaryStore;
  let adapter: MockAdapter;

  beforeEach(() => {
    dbPath = join(tmpdir(), `tl-pipeline-${Date.now()}.db`);
    store = new GlossaryStore(dbPath);
    adapter = new MockAdapter();
  });

  afterEach(() => {
    store.close();
    rmSync(dbPath, { force: true });
  });

  it("translates without glossary", async () => {
    const result = await runPipeline("Hello world", "en", "ar", adapter, store);
    expect(result.translated).toContain("[ar]");
    expect(result.glossaryCoverage).toBe(1);
    expect(result.missingTerms).toHaveLength(0);
    expect(result.metadata.retries).toBe(0);
  });

  it("counts the distinct glossary terms matched in the source", async () => {
    expect((await runPipeline("Hello world", "en", "ar", adapter, store)).glossaryTerms).toBe(0);
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    store.add({ sourceTerm: "cache", targetTerm: "الكاش", sourceLang: "en", targetLang: "ar" });
    expect((await runPipeline("The API cache and the API", "en", "ar", adapter, store)).glossaryTerms).toBe(2);
    // Images skip the glossary, so no term counts as matched.
    expect((await runPipeline("API", "en", "ar", adapter, store, { imageBase64: "dGVzdA==" })).glossaryTerms).toBe(0);
  });

  it("injects and covers glossary terms", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const result = await runPipeline("The API is fast", "en", "ar", adapter, store);
    expect(result.translated).toContain("واجهة برمجة");
    expect(result.glossaryCoverage).toBe(1);
    expect(result.missingTerms).toHaveLength(0);
  });

  it("strips XML tags from translation output", async () => {
    const result = await runPipeline("Hello world", "en", "ar", adapter, store);
    expect(result.translated).not.toMatch(/<term/);
  });

  it("prefer mode returns result even with missing terms", async () => {
    // "API" appears in the source text, so matchTerms produces a hit.
    // AlwaysMissAdapter never includes the translation → coverage < 1.
    // prefer mode should return the result instead of throwing.
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    class AlwaysMissAdapter {
      readonly name = "always-miss";
      async translate(req: any) {
        return {
          translated: "[ar] untranslated",
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 0,
          missingTerms: [],
          metadata: { adapter: "always-miss", durationMs: 0, retries: 0 },
        };
      }
      async dispose() {}
    }
    const missAdapter = new AlwaysMissAdapter() as any;
    const result = await runPipeline("The API is ready", "en", "ar", missAdapter, store, { glossaryMode: "prefer", maxRetries: 0 });
    expect(result.glossaryCoverage).toBeLessThan(1);
    expect(result.missingTerms).toContain("API");
  });

  it("strict mode accepts an echoed term tag with the model's own word inside, without retrying", async () => {
    store.add({ sourceTerm: "branch", targetTerm: "Zweig", sourceLang: "en", targetLang: "de" });
    let calls = 0;
    const echoAdapter = {
      name: "echo-wrong-inner",
      async translate(req: any) {
        calls++;
        return {
          translated: 'Erstellen Sie eine neue <term translation="Zweig">Abteilung</term> für diese Funktion.',
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "echo-wrong-inner", durationMs: 0, retries: 0 },
        };
      },
      async dispose() {},
    };
    const result = await runPipeline("Create a new branch for this feature.", "en", "de", echoAdapter as any, store, { glossaryMode: "strict" });
    // The second call is the agreement repair (it echoes the tag again, which changes nothing).
    expect(calls).toBe(2);
    expect(result.metadata.retries).toBe(0);
    expect(result.translated).toBe("Erstellen Sie eine neue Zweig für diese Funktion.");
    expect(result.missingTerms).toHaveLength(0);
  });

  it("image mode: skips glossary tag injection and passes imageBase64 to adapter", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    let capturedRequest: any;
    const capturingAdapter = {
      name: "capturing",
      async translate(req: any) {
        capturedRequest = req;
        return {
          translated: "[image] result",
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 1,
          missingTerms: [],
          metadata: { adapter: "capturing", durationMs: 0, retries: 0 },
        };
      },
      async dispose() {},
    };
    const imageBase64 = "dGVzdA=="; // base64 for "test"
    const result = await runPipeline("", "en", "ar", capturingAdapter as any, store, { imageBase64 });
    expect(capturedRequest.imageBase64).toBe(imageBase64);
    expect(capturedRequest.glossaryHits).toHaveLength(0); // no tag injection for images
    expect(result.translated).toBe("[image] result");
  });

  it("strict mode throws after max retries when terms are missing", async () => {
    // Use a glossary term that MockAdapter won't include in output (not in source text)
    // Since matchTerms checks source text, if the term isn't in source, there are no hits
    // We need a scenario where hits exist but term isn't in output
    // MockAdapter does substitute, so let's force a miss by using a term not in source
    // Actually we can't force a miss easily with MockAdapter. Let's use a custom adapter.
    class AlwaysMissAdapter {
      readonly name = "always-miss";
      async translate(req: any) {
        return {
          translated: "[ar] untranslated",
          sourceLang: req.sourceLang,
          targetLang: req.targetLang,
          glossaryCoverage: 0,
          missingTerms: [],
          metadata: { adapter: "always-miss", durationMs: 0, retries: 0 },
        };
      }
      async dispose() {}
    }

    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const missAdapter = new AlwaysMissAdapter() as any;

    let err: any;
    try {
      await runPipeline("The API is ready", "en", "ar", missAdapter, store, { glossaryMode: "strict", maxRetries: 1 });
    } catch (e) {
      err = e;
    }
    expect(err?.tag).toBe("GLOSSARY_STRICT_MISS");
  });

  it("strict retry: keeps the source text unchanged and passes target terms as a reminder", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const requests: any[] = [];
    // Misses the term on the first attempt, then defers to MockAdapter.
    const mock = new MockAdapter();
    const flakyAdapter = {
      name: "flaky",
      async translate(req: any) {
        requests.push(req);
        if (requests.length === 1) {
          return { ...(await mock.translate(req)), translated: "[ar] untranslated" };
        }
        return mock.translate(req);
      },
      async dispose() {},
    };

    const result = await runPipeline("The API is ready", "en", "ar", flakyAdapter as any, store, { glossaryMode: "strict", maxRetries: 2 });

    expect(requests).toHaveLength(2);
    expect(requests[0].glossaryReminder).toBeUndefined();
    expect(requests[1].source).toBe(requests[0].source);
    expect(requests[1].source).not.toContain("Note");
    expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
    expect(result.metadata.retries).toBe(1);
    expect(result.missingTerms).toHaveLength(0);
    expect(result.translated).toContain("واجهة برمجة");
  });

  it("strict mode code-switches only its last allowed retry", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const codeSwitched = '<term translation="واجهة برمجة" source="API">واجهة برمجة</term>';
    for (const maxRetries of [1, 2, 3]) {
      const requests: any[] = [];
      const missAdapter = {
        async translate(req: any) {
          requests.push(req);
          return { ...(await new MockAdapter().translate(req)), translated: "[ar] untranslated" };
        },
        async dispose() {},
      };
      await expect(runPipeline("The API", "en", "ar", missAdapter as any, store, { glossaryMode: "strict", maxRetries })).rejects.toMatchObject({
        tag: "GLOSSARY_STRICT_MISS",
      });
      expect(requests).toHaveLength(maxRetries + 1);
      const last = requests.at(-1);
      expect(last.source).toBe(`The ${codeSwitched}`);
      expect(last.glossaryReminder).toBeUndefined();
      for (const req of requests.slice(0, -1)) expect(req.source).toBe('The <term translation="واجهة برمجة">API</term>');
      for (const req of requests.slice(1, -1)) expect(req.glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
    }
  });

  it("MockAdapter ignoreGlossary misses on every attempt, the code-switched one included", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const result = await runPipeline("The API is ready", "en", "ar", new MockAdapter({ ignoreGlossary: true }), store, { glossaryMode: "prefer" });
    expect(result.translated).toBe("[ar] The API is ready");
    expect(result.missingTerms).toEqual(["API"]);
    expect(result.metadata.retries).toBe(2);

    // Same-script term: the code-switched tag has no source attribute.
    store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
    const requests: any[] = [];
    const mock = new MockAdapter({ ignoreGlossary: true });
    const recording = { translate: (req: any) => (requests.push(req), mock.translate(req)), dispose: async () => {} };
    const fr = await runPipeline("Restart the server", "en", "fr", recording as any, store, { glossaryMode: "prefer" });
    expect(requests[2].source).toBe('Restart the <term translation="hôte">hôte</term>');
    expect(fr.translated).toBe("[fr] Restart the server");
    expect(fr.missingTerms).toEqual(["server"]);
  });

  it("forwards the signal to every attempt", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const signals: (AbortSignal | undefined)[] = [];
    const missAdapter = {
      async translate(req: any) {
        signals.push(req.signal);
        return { ...(await new MockAdapter().translate(req)), translated: "[ar] untranslated" };
      },
      async dispose() {},
    };
    const controller = new AbortController();
    await expect(
      runPipeline("The API", "en", "ar", missAdapter as any, store, { glossaryMode: "strict", maxRetries: 2, signal: controller.signal }),
    ).rejects.toMatchObject({ tag: "GLOSSARY_STRICT_MISS" });
    expect(signals).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it("stops retrying once the signal is aborted", async () => {
    store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
    const controller = new AbortController();
    let calls = 0;
    // Ignores the signal itself, so only the pipeline can stop the retries.
    const missAdapter = {
      async translate(req: any) {
        calls++;
        controller.abort();
        return { ...(await new MockAdapter().translate({ ...req, signal: undefined })), translated: "[ar] untranslated" };
      },
      async dispose() {},
    };
    await expect(
      runPipeline("The API", "en", "ar", missAdapter as any, store, { glossaryMode: "strict", maxRetries: 2, signal: controller.signal }),
    ).rejects.toMatchObject({ tag: "CANCELLED" });
    expect(calls).toBe(1);
  });

  describe("agreement fix-up around glossary terms", () => {
    const fixedAdapter = (translated: string) =>
      ({
        name: "fixed",
        async translate(req: any) {
          return { translated, sourceLang: req.sourceLang, targetLang: req.targetLang, glossaryCoverage: 1, missingTerms: [], metadata: { adapter: "fixed", durationMs: 0, retries: 0 } };
        },
        async dispose() {},
      }) as any;

    it("unquotes and elides around a real target term before computing coverage", async () => {
      store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
      const result = await runPipeline("Restart the server.", "en", "fr-CA", fixedAdapter('Redémarrez le « <term translation="hôte">serveur</term> ».'), store, { glossaryMode: "strict" });
      expect(result.translated).toBe("Redémarrez l'hôte.");
      expect(result.missingTerms).toHaveLength(0);
    });

    it("leaves a kept inflected form intact (no elision or article drop inside it)", async () => {
      store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
      const fr = await runPipeline("Restart the servers.", "en", "fr", fixedAdapter('Redémarrez les <term translation="hôte">hôtes</term>.'), store);
      expect(fr.translated).toBe("Redémarrez les hôtes.");
      expect(fr.missingTerms).toHaveLength(0);

      store.add({ sourceTerm: "commit", targetTerm: "كوميت", sourceLang: "en", targetLang: "ar" });
      store.add({ sourceTerm: "cache", targetTerm: "الكاش", sourceLang: "en", targetLang: "ar" });
      const raw = 'ادفع <term translation="كوميت">الكوميت</term> بعد مسح <term translation="الكاش">والكاش</term>';
      const ar = await runPipeline("Push the commit after clearing the cache.", "en", "ar", fixedAdapter(raw), store);
      expect(ar.translated).toBe("ادفع الكوميت بعد مسح والكاش");
      expect(ar.missingTerms).toHaveLength(0);
      // The doubled-article drop still fires on the bare term.
      const doubled = await runPipeline("Clear the cache.", "en", "ar", fixedAdapter('امسح الـ <term translation="الكاش">الكاش</term>'), store);
      expect(doubled.translated).toBe("امسح الكاش");
    });

    it("keeps the term capitalized as the model wrote it and counts it as covered", async () => {
      store.add({ sourceTerm: "deploy", targetTerm: "bereitstellen", sourceLang: "en", targetLang: "de" });
      const de = await runPipeline("Deploy", "en", "de", fixedAdapter('<term translation="bereitstellen">Bereitstellen</term>'), store, { glossaryMode: "strict" });
      expect(de.translated).toBe("Bereitstellen");
      expect(de.missingTerms).toHaveLength(0);
      expect(de.metadata.retries).toBe(0);

      store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
      const fr = await runPipeline("Server details", "en", "fr", fixedAdapter('<term translation="hôte">Serveur</term> : détails'), store, { glossaryMode: "strict" });
      expect(fr.translated).toBe("Hôte : détails");
      expect(fr.missingTerms).toHaveLength(0);
      expect(fr.metadata.retries).toBe(0);
    });

    it("leaves placeholder sentinels (extra hits) alone", async () => {
      const TOK = "__TLPH_0__";
      const text = `Open ${TOK}`;
      const hit = { entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "fr" }, startIndex: 5, endIndex: 5 + TOK.length };
      const result = await runPipeline(text, "en", "fr", fixedAdapter(`Ouvrez le « ${TOK} »`), store, { extraGlossaryHits: [hit] });
      expect(result.translated).toBe(`Ouvrez le « ${TOK} »`);
    });
  });

  describe("prefer-mode retries", () => {
    // Returns outputs[i] for the i-th call (the last one repeats) and records every request.
    function scriptedAdapter(outputs: string[], requests: any[], onCall?: () => void) {
      return {
        name: "scripted",
        async translate(req: any) {
          requests.push(req);
          onCall?.();
          return {
            translated: outputs[Math.min(requests.length, outputs.length) - 1],
            sourceLang: req.sourceLang,
            targetLang: req.targetLang,
            glossaryCoverage: 1,
            missingTerms: [],
            metadata: { adapter: "scripted", durationMs: 0, retries: 0 },
          };
        },
        async dispose() {},
      } as any;
    }

    beforeEach(() => {
      store.add({ sourceTerm: "API", targetTerm: "واجهة", sourceLang: "en", targetLang: "ar" });
      store.add({ sourceTerm: "server", targetTerm: "خادم", sourceLang: "en", targetLang: "ar" });
    });

    it("retries a miss once with a reminder and returns the better result", async () => {
      const requests: any[] = [];
      const onChunk = () => {};
      const result = await runPipeline("The API is ready", "en", "ar", scriptedAdapter(["first miss", "second واجهة"], requests), store, {
        glossaryMode: "prefer", maxRetries: 5, onChunk,
      });
      expect(requests).toHaveLength(2);
      expect(requests[0].glossaryReminder).toBeUndefined();
      expect(requests[0].onChunk).toBe(onChunk);
      expect(requests[1].source).toBe(requests[0].source);
      expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة" }]);
      expect(requests[1].onChunk).toBeUndefined();
      expect(result.translated).toBe("second واجهة");
      expect(result.glossaryCoverage).toBe(1);
      expect(result.metadata.retries).toBe(1);
    });

    it("makes no retry when the first attempt covers every term", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API is ready", "en", "ar", scriptedAdapter(["ok واجهة"], requests), store, { glossaryMode: "prefer" });
      expect(requests).toHaveLength(1);
      expect(result.metadata.retries).toBe(0);
    });

    it("makes exactly two retries, keeps the first result on a tie and never throws", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API is ready", "en", "ar", scriptedAdapter(["first miss", "second miss", "third miss"], requests), store, {
        glossaryMode: "prefer", maxRetries: 5,
      });
      expect(requests).toHaveLength(3);
      expect(result.translated).toBe("first miss");
      expect(result.missingTerms).toEqual(["API"]);
      expect(result.metadata.retries).toBe(2);
    });

    it("keeps the first result when the retries cover fewer terms", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API server", "en", "ar", scriptedAdapter(["first واجهة", "second miss"], requests), store, { glossaryMode: "prefer" });
      expect(requests).toHaveLength(3);
      expect(requests[1].glossaryReminder).toEqual([{ source: "server", target: "خادم" }]);
      expect(result.translated).toBe("first واجهة");
      expect(result.glossaryCoverage).toBe(0.5);
    });

    it("returns the highest-coverage attempt", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API server", "en", "ar", scriptedAdapter(["first miss", "second واجهة", "third miss"], requests), store, { glossaryMode: "prefer" });
      expect(requests).toHaveLength(3);
      expect(result.translated).toBe("second واجهة");
      expect(result.metadata.retries).toBe(2);
    });

    it("code-switches the final retry: target terms in the source, source words as attributes, no reminder", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API is ready", "en", "ar", scriptedAdapter(["first miss", "second miss", "third واجهة"], requests), store, {
        glossaryMode: "prefer",
      });
      // The 4th request is the agreement repair of the code-switched result.
      expect(requests).toHaveLength(4);
      expect(requests[3].repairTerms).toEqual(["واجهة"]);
      expect(requests[1].source).toBe(requests[0].source);
      expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة" }]);
      expect(requests[2].source).toBe('The <term translation="واجهة" source="API">واجهة</term> is ready');
      expect(requests[2].glossaryReminder).toBeUndefined();
      expect(requests[2].onChunk).toBeUndefined();
      expect(result.translated).toBe("third واجهة");
      expect(result.glossaryCoverage).toBe(1);
      expect(result.metadata.retries).toBe(2);
    });

    it("starts no retry once the signal is aborted", async () => {
      const controller = new AbortController();
      const requests: any[] = [];
      const adapter = scriptedAdapter(["miss"], requests, () => controller.abort());
      await expect(
        runPipeline("The API is ready", "en", "ar", adapter, store, { glossaryMode: "prefer", signal: controller.signal }),
      ).rejects.toMatchObject({ tag: "CANCELLED" });
      expect(requests).toHaveLength(1);
    });
  });

  describe("agreement repair", () => {
    const TEXT = "Create a new branch for this feature.";
    const ECHO = 'Erstellen Sie eine neue <term translation="Zweig">Abteilung</term> für diese Funktion.';
    const DRAFT = "Erstellen Sie eine neue Zweig für diese Funktion.";
    const REPAIRED = "Erstellen Sie einen neuen Zweig für diese Funktion.";

    // Translation requests get `translations[i]` (the last repeats); repair requests get `repair`.
    function repairAdapter(translations: string[], repair: string | ((req: any) => string), requests: any[]) {
      let n = 0;
      return {
        name: "repair",
        async translate(req: any) {
          requests.push(req);
          const translated = req.repairTerms ? (typeof repair === "string" ? repair : repair(req)) : translations[Math.min(++n, translations.length) - 1];
          return { translated, sourceLang: req.sourceLang, targetLang: req.targetLang, glossaryCoverage: 1, missingTerms: [], metadata: { adapter: "repair", durationMs: 0, retries: 0 } };
        },
        async dispose() {},
      } as any;
    }

    beforeEach(() => {
      store.add({ sourceTerm: "branch", targetTerm: "Zweig", sourceLang: "en", targetLang: "de" });
    });

    it("repairs a result whose term was substituted into an echoed tag", async () => {
      const requests: any[] = [];
      const controller = new AbortController();
      const onChunk = () => {};
      const result = await runPipeline(TEXT, "en", "de", repairAdapter([ECHO], REPAIRED, requests), store, { signal: controller.signal, onChunk });
      expect(requests).toHaveLength(2);
      const repair = requests[1];
      expect(repair.source).toBe(DRAFT);
      expect(repair.repairTerms).toEqual(["Zweig"]);
      expect(repair.sourceLang).toBe("en");
      expect(repair.targetLang).toBe("de");
      expect(repair.signal).toBe(controller.signal);
      expect(repair.onChunk).toBeUndefined();
      expect(repair.glossaryHits).toBeUndefined();
      expect(result.translated).toBe(REPAIRED);
      expect(result.metadata.repaired).toBe(true);
      expect(result.metadata.retries).toBe(0);
      expect(result.missingTerms).toEqual([]);
    });

    it("repairs in strict mode too", async () => {
      const requests: any[] = [];
      const result = await runPipeline(TEXT, "en", "de", repairAdapter([ECHO], REPAIRED, requests), store, { glossaryMode: "strict" });
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe(REPAIRED);
    });

    it("applies the deterministic fix-ups to the repaired text", async () => {
      store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
      const requests: any[] = [];
      const result = await runPipeline("The server is down.", "en", "fr", repairAdapter(['Le <term translation="hôte">serveur</term> est hors service.'], "Le « hôte » est hors services.", requests), store);
      expect(result.translated).toBe("L'hôte est hors services.");
      expect(result.metadata.repaired).toBe(true);
    });

    it("merges a detached ل into an ال-initial term and counts the merge as covered, without a retry", async () => {
      store.add({ sourceTerm: "cache", targetTerm: "الكاش", sourceLang: "en", targetLang: "ar" });
      store.add({ sourceTerm: "language", targetTerm: "اللغة", sourceLang: "en", targetLang: "ar" });
      const requests: any[] = [];
      const detached = await runPipeline("Choose a name for the cache.", "en", "ar", repairAdapter(["اختر اسماً لـ الكاش."], "unused", requests), store);
      expect(detached.translated).toBe("اختر اسماً للكاش.");
      expect(detached.glossaryCoverage).toBe(1);
      expect(requests).toHaveLength(1);
      const own = await runPipeline("Support for the language is limited.", "en", "ar", repairAdapter(["الدعم للغة محدود."], "unused", requests), store);
      expect(own.translated).toBe("الدعم للغة محدود.");
      expect(own.missingTerms).toEqual([]);
      expect(own.metadata.retries).toBe(0);
    });

    it("counts the ل merge as covered when the model writes harakat on it", async () => {
      store.add({ sourceTerm: "token", targetTerm: "التوكن", sourceLang: "en", targetLang: "ar" });
      store.add({ sourceTerm: "language", targetTerm: "اللغة", sourceLang: "en", targetLang: "ar" });
      const requests: any[] = [];
      for (const [text, out] of [["Support for the language is limited.", "الدعم للّغة محدود."], ["This space is reserved for the token.", "هذه المساحة مخصصة للتّوكن."]]) {
        const result = await runPipeline(text, "en", "ar", repairAdapter([out], "unused", requests), store);
        expect(result.translated).toBe(out);
        expect(result.missingTerms).toEqual([]);
        expect(result.metadata.retries).toBe(0);
      }
    });

    it("accepts an Arabic repair that merges ل with the term's ال", async () => {
      store.add({ sourceTerm: "token", targetTerm: "التوكن", sourceLang: "en", targetLang: "ar" });
      const requests: any[] = [];
      const raw = 'يمكن <term translation="التوكن">رمز</term> أن يعمل.';
      const result = await runPipeline("The token can work.", "en", "ar", repairAdapter([raw], "يمكن للتوكن أن يعمل.", requests), store);
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe("يمكن للتوكن أن يعمل.");
      expect(result.metadata.repaired).toBe(true);
      expect(result.missingTerms).toEqual([]);
      expect(result.glossaryCoverage).toBe(1);
    });

    it("accepts the ل merge of a term whose stem starts with ل, and rejects the triple lam", async () => {
      store.add({ sourceTerm: "language", targetTerm: "اللغة", sourceLang: "en", targetLang: "ar" });
      const raw = 'الدعم <term translation="اللغة">لغة</term> محدود.';
      const merged = await runPipeline("Support for the language is limited.", "en", "ar", repairAdapter([raw], "الدعم للغة محدود.", []), store);
      expect(merged.translated).toBe("الدعم للغة محدود.");
      expect(merged.metadata.repaired).toBe(true);
      const triple = await runPipeline("Support for the language is limited.", "en", "ar", repairAdapter([raw], "الدعم لللغة محدود.", []), store);
      expect(triple.translated).toBe("الدعم اللغة محدود.");
      expect(triple.metadata.repaired).toBeUndefined();
    });

    it("does not repair when the model wrote the term itself", async () => {
      const requests: any[] = [];
      const own = 'Erstellen Sie einen neuen <term translation="Zweig">Zweig</term> für diese Funktion.';
      const result = await runPipeline(TEXT, "en", "de", repairAdapter([own, "Erstellen Sie einen neuen Zweig."], "unused", requests), store);
      expect(requests).toHaveLength(1);
      expect(result.metadata.repaired).toBeUndefined();
      // MockAdapter writes the target term inside the tag: no extra call either.
      const calls: any[] = [];
      const mock = new MockAdapter();
      const spy = { async translate(req: any) { calls.push(req); return mock.translate(req); }, async dispose() {} } as any;
      await runPipeline(TEXT, "en", "de", spy, store);
      expect(calls).toHaveLength(1);
    });

    it("does not repair when the model wrote its own inflected form of the term in the tag", async () => {
      store.add({ sourceTerm: "commit", targetTerm: "كوميت", sourceLang: "en", targetLang: "ar" });
      store.add({ sourceTerm: "deploy", targetTerm: "نشر", sourceLang: "en", targetLang: "ar" });
      const text = "Push the commit, then deploy.";
      const requests: any[] = [];
      const kept = 'ادفع <term translation="كوميت">الكوميت</term>، ثم <term translation="نشر">"انشر"</term>.';
      const result = await runPipeline(text, "en", "ar", repairAdapter([kept], "unused", requests), store);
      expect(requests).toHaveLength(1);
      expect(result.translated).toBe("ادفع الكوميت، ثم انشر.");
      expect(result.missingTerms).toEqual([]);
      expect(result.metadata.repaired).toBeUndefined();

      // One substituted tag next to a kept one still gets the repair.
      const mixedRequests: any[] = [];
      const mixed = 'ادفع <term translation="كوميت">الالتزام</term>، ثم <term translation="نشر">انشر</term>.';
      const repaired = await runPipeline(text, "en", "ar", repairAdapter([mixed], "ادفع الكوميت، ثم انشر.", mixedRequests), store);
      expect(mixedRequests).toHaveLength(2);
      expect(mixedRequests[1].source).toBe("ادفع كوميت، ثم انشر.");
      expect(repaired.translated).toBe("ادفع الكوميت، ثم انشر.");
    });

    it("accepts a glossary entry's other forms in tags, coverage and the repair", async () => {
      const entry = { id: "d", sourceTerm: "deploy", targetTerm: "bereitstellen", sourceLang: "en", targetLang: "de", forms: ["Bereitstellung", "stellen … bereit"] };
      const opts = { glossaryEntries: [entry] };

      // A form in the tag is kept: no substitution, so no repair, and no retry.
      const tagged: any[] = [];
      const kept = await runPipeline("Roll back before you deploy again.", "en", "de", repairAdapter(['Vor der erneuten <term translation="bereitstellen">Bereitstellung</term> zurücksetzen.'], "unused", tagged), store, opts);
      expect(tagged).toHaveLength(1);
      expect(kept.translated).toBe("Vor der erneuten Bereitstellung zurücksetzen.");
      expect(kept.missingTerms).toEqual([]);

      // A split form written without the tag covers the term on the first attempt.
      const split: any[] = [];
      const placed = await runPipeline("Deploy the branch now.", "en", "de", repairAdapter(["Stellen Sie den Zweig jetzt bereit."], "unused", split), store, opts);
      expect(split).toHaveLength(1);
      expect(placed.missingTerms).toEqual([]);

      // A forced term's repair may write a form instead; the repair names the form the draft has.
      const repairs: any[] = [];
      const repaired = await runPipeline("Deploy now", "en", "de", repairAdapter(['<term translation="bereitstellen">Einsatz</term> jetzt'], "Jetzt bereitstellen", repairs), store, opts);
      expect(repairs).toHaveLength(2);
      expect(repairs[1].repairTerms).toEqual(["bereitstellen"]);
      expect(repaired.translated).toBe("Jetzt bereitstellen");
      const toForm = await runPipeline("Deploy now", "en", "de", repairAdapter(['<term translation="bereitstellen">Einsatz</term> jetzt'], "Stellen Sie jetzt bereit", []), store, opts);
      expect(toForm.translated).toBe("Stellen Sie jetzt bereit");
      expect(toForm.metadata.repaired).toBe(true);
    });

    it("does not repair without a real glossary term (no glossary, sentinels only, image mode)", async () => {
      const requests: any[] = [];
      await runPipeline("Hello", "en", "de", repairAdapter(['Hallo <term translation="Zweig">Ast</term>'], "unused", requests), store);
      expect(requests).toHaveLength(1);

      const TOK = "__TLPH_0__";
      const text = `Open ${TOK}`;
      const hit = { entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "de" }, startIndex: 5, endIndex: 5 + TOK.length };
      const sentinelRequests: any[] = [];
      await runPipeline(text, "en", "de", repairAdapter([`Öffnen <term translation="${TOK}">x</term>`], "unused", sentinelRequests), store, { extraGlossaryHits: [hit] });
      expect(sentinelRequests).toHaveLength(1);

      const imageRequests: any[] = [];
      await runPipeline("", "en", "de", repairAdapter([ECHO], "unused", imageRequests), store, { imageBase64: "dGVzdA==" });
      expect(imageRequests).toHaveLength(1);
    });

    it("repairs a code-switched winner but not an earlier, unforced winner", async () => {
      const requests: any[] = [];
      const result = await runPipeline(TEXT, "en", "de", repairAdapter(["miss", "miss", DRAFT], REPAIRED, requests), store);
      expect(requests).toHaveLength(4);
      expect(requests[3].repairTerms).toEqual(["Zweig"]);
      expect(result.translated).toBe(REPAIRED);
      expect(result.metadata.retries).toBe(2);

      // Two terms: the first attempt covers one by itself, the code-switched retry ties and loses.
      store.add({ sourceTerm: "feature", targetTerm: "Funktion", sourceLang: "en", targetLang: "de" });
      const tieRequests: any[] = [];
      const tie = await runPipeline(TEXT, "en", "de", repairAdapter(["Einen neuen Zweig erstellen.", "miss", "Eine neue Zweig."], "unused", tieRequests), store);
      expect(tieRequests).toHaveLength(3);
      expect(tie.translated).toBe("Einen neuen Zweig erstellen.");
    });

    it("repairs only with the terms the draft contains", async () => {
      store.add({ sourceTerm: "feature", targetTerm: "Feature", sourceLang: "en", targetLang: "de" });
      const requests: any[] = [];
      const result = await runPipeline(TEXT, "en", "de", repairAdapter([ECHO], REPAIRED, requests), store);
      expect(requests).toHaveLength(4);
      expect(requests[3].repairTerms).toEqual(["Zweig"]);
      expect(result.translated).toBe(REPAIRED);
      expect(result.missingTerms).toEqual(["feature"]);
    });

    it("keeps the draft when the repair drops a term, changes the sentinels or the length, or adds markdown", async () => {
      const TOK = "__TLPH_0__";
      const text = `Create a new branch for ${TOK}.`;
      const hit = { entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "de" }, startIndex: text.indexOf(TOK), endIndex: text.indexOf(TOK) + TOK.length };
      const echo = `Erstellen Sie eine neue <term translation="Zweig">Abteilung</term> für ${TOK}.`;
      const draft = `Erstellen Sie eine neue Zweig für ${TOK}.`;
      for (const bad of [
        `Erstellen Sie einen neuen Ast für ${TOK}.`, // term lost
        "Erstellen Sie einen neuen Zweig für diese.", // sentinel lost
        `Erstellen Sie einen neuen Zweig für ${TOK} ${TOK}.`, // sentinel duplicated
        `Erstellen Sie einen neuen Zweig für ${TOK}. Das ist eine längere Erklärung dazu.`, // too long
        `Zweig ${TOK}.`, // too short
        `Erstellen Sie einen neuen **Zweig** für ${TOK}.`, // markdown emphasis added
      ]) {
        const requests: any[] = [];
        const result = await runPipeline(text, "en", "de", repairAdapter([echo], bad, requests), store, { extraGlossaryHits: [hit] });
        expect(requests).toHaveLength(2);
        expect(result.translated).toBe(draft);
        expect(result.metadata.repaired).toBeUndefined();
      }
    });

    it("keeps the draft when the repair only appends end punctuation the source lacks", async () => {
      const TOK = "__TLPH_0__";
      const hit = (text: string) => ({ entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "de" }, startIndex: text.indexOf(TOK), endIndex: text.indexOf(TOK) + TOK.length });
      for (const [text, echo, repair] of [
        ["Delete the branch", 'Löschen Sie den <term translation="Zweig">Ast</term>', "Löschen Sie den Zweig."],
        ["Delete the branch", 'Löschen Sie den <term translation="Zweig">Ast</term>', "Löschen Sie den Zweig !"],
        [`Rename the branch ${TOK}`, `Benennen Sie den <term translation="Zweig">Ast</term> ${TOK} um`, `Benennen Sie den Zweig ${TOK} um.`],
        [`Branch: ${TOK}`, `<term translation="Zweig">Ast</term>: ${TOK}`, `Zweig: ${TOK}.`], // the source ends with a sentinel
      ]) {
        const requests: any[] = [];
        const extraGlossaryHits = text.includes(TOK) ? [hit(text)] : [];
        const result = await runPipeline(text, "en", "de", repairAdapter([echo], repair, requests), store, { extraGlossaryHits });
        expect(requests).toHaveLength(2);
        expect(result.translated).toBe(repair.replace(/\s*[.!]$/, ""));
        expect(result.metadata.repaired).toBeUndefined();
      }

      // A period the source has is restored, and a repair that also fixes agreement is kept (without the added period).
      for (const [text, echo, repair, expected] of [
        ["Delete the branch.", 'Löschen Sie den <term translation="Zweig">Ast</term>', "Löschen Sie den Zweig.", "Löschen Sie den Zweig."],
        ["Create a new branch", 'Erstelle eine neue <term translation="Zweig">Abteilung</term>', "Erstelle einen neuen Zweig.", "Erstelle einen neuen Zweig"],
      ]) {
        const result = await runPipeline(text, "en", "de", repairAdapter([echo], repair, []), store);
        expect(result.translated).toBe(expected);
        expect(result.metadata.repaired).toBe(true);
      }
    });

    it("keeps the draft when the repair call fails", async () => {
      const requests: any[] = [];
      const adapter = repairAdapter([ECHO], () => {
        throw new TlError("TRANSLATION_FAILED", "boom", "hint");
      }, requests);
      const result = await runPipeline(TEXT, "en", "de", adapter, store);
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe(DRAFT);
    });

    it("surfaces a cancellation during the repair as CANCELLED", async () => {
      const controller = new AbortController();
      const requests: any[] = [];
      // Aborts, then fails with a non-cancel error, as a fetch abort could.
      const adapter = repairAdapter([ECHO], () => {
        controller.abort();
        throw new Error("socket closed");
      }, requests);
      await expect(runPipeline(TEXT, "en", "de", adapter, store, { signal: controller.signal })).rejects.toMatchObject({ tag: "CANCELLED" });
      expect(requests).toHaveLength(2);

      // The adapter's own CANCELLED passes through.
      const own = repairAdapter([ECHO], () => {
        throw new TlError("CANCELLED", "Translation cancelled", "hint");
      }, []);
      await expect(runPipeline(TEXT, "en", "de", own, store)).rejects.toMatchObject({ tag: "CANCELLED" });
    });

    it("starts no repair once the signal is aborted", async () => {
      const controller = new AbortController();
      const requests: any[] = [];
      const adapter = repairAdapter([ECHO], "unused", requests);
      const aborting = { ...adapter, translate: async (req: any) => { const res = await adapter.translate(req); controller.abort(); return res; } };
      await expect(runPipeline(TEXT, "en", "de", aborting, store, { signal: controller.signal })).rejects.toMatchObject({ tag: "CANCELLED" });
      expect(requests).toHaveLength(1);
    });
  });

  describe("tag check", () => {
    const AUTO_TEXT = "Deploy automatically after each commit.";
    const AUTO_RAW = '<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.';
    const AUTO_CHECK_SOURCE = '<term translation="bereitstellen">bereitstellen</term> automatically after each commit.';
    const KEPT = "Automatisch nach jedem Commit bereitstellen.";
    const STRIPPED = "Bereitstellen nach jedem Commit bereitstellen.";
    const deploy = { id: "d", sourceTerm: "deploy", targetTerm: "bereitstellen", sourceLang: "en", targetLang: "de", forms: ["Bereitstellung", "stellen … bereit"] };
    const branch = { id: "b", sourceTerm: "branch", targetTerm: "Zweig", sourceLang: "en", targetLang: "de" };

    // Translation requests (attempts and checks) get `translations[i]` in order; a
    // function entry throws or computes. Repair requests get `repair` (default: the draft back).
    function checkAdapter(translations: (string | ((req: any) => string))[], requests: any[], repair?: string) {
      let n = 0;
      return {
        name: "check",
        async translate(req: any) {
          requests.push(req);
          const next = req.repairTerms ? (repair ?? req.source) : translations[n++];
          if (next === undefined) throw new Error(`unexpected request ${requests.length}`);
          const translated = typeof next === "string" ? next : next(req);
          return { translated, sourceLang: req.sourceLang, targetLang: req.targetLang, glossaryCoverage: 1, missingTerms: [], metadata: { adapter: "check", durationMs: 0, retries: 0 } };
        },
        async dispose() {},
      } as any;
    }

    it("keeps the model's word when the check writes it next to the term", async () => {
      const requests: any[] = [];
      const controller = new AbortController();
      const result = await runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, KEPT], requests), store, {
        glossaryEntries: [deploy], signal: controller.signal, onChunk: () => {}, contextSnippets: ["Deploy means bereitstellen."],
      });
      expect(requests).toHaveLength(2);
      const check = requests[1];
      expect(check.source).toBe(AUTO_CHECK_SOURCE);
      expect(check.glossaryReminder).toBeUndefined();
      expect(check.onChunk).toBeUndefined();
      expect(check.contextSnippets).toBeUndefined();
      expect(check.repairTerms).toBeUndefined();
      expect(check.signal).toBe(controller.signal);
      expect(result.translated).toBe(KEPT);
      expect(result.missingTerms).toEqual([]);
      expect(result.glossaryCoverage).toBe(1);
      expect(result.metadata.tagChecked).toBe(true);
      expect(result.metadata.keptWord).toBe(true);
      expect(result.metadata.repaired).toBeUndefined();
      expect(result.metadata.retries).toBe(0);
    });

    it("drops a full stop the source lacks from a kept-word result too", async () => {
      const requests: any[] = [];
      const result = await runPipeline("Deploy automatically after each commit", "en", "de", checkAdapter([AUTO_RAW, KEPT], requests), store, { glossaryEntries: [deploy] });
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe("Automatisch nach jedem Commit bereitstellen");
      expect(result.metadata.keptWord).toBe(true);
    });

    it("strips the tag when the check translates the source word as the term, then repairs", async () => {
      const repository = { id: "r", sourceTerm: "repository", targetTerm: "dépôt", sourceLang: "en", targetLang: "fr" };
      const raw = 'Copier le <term translation="dépôt">répertoire</term> vers un autre dépôt distant.';
      const requests: any[] = [];
      const result = await runPipeline("Mirror the repository to a second remote.", "en", "fr", checkAdapter([raw, "Répliquer le dépôt vers un deuxième serveur distant."], requests), store, { glossaryEntries: [repository] });
      expect(requests).toHaveLength(3);
      expect(requests[1].source).toBe('Mirror the <term translation="dépôt">dépôt</term> to a second remote.');
      expect(requests[2].repairTerms).toEqual(["dépôt"]);
      expect(requests[2].source).toBe("Copier le dépôt vers un autre dépôt distant.");
      expect(result.translated).toBe("Copier le dépôt vers un autre dépôt distant.");
      expect(result.metadata.tagChecked).toBe(true);
      expect(result.metadata.keptWord).toBeUndefined();
    });

    it("strips the tag when the check has the word but not the term", async () => {
      const requests: any[] = [];
      const result = await runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, "Automatisch nach jedem Commit."], requests), store, { glossaryEntries: [deploy] });
      expect(requests).toHaveLength(3);
      expect(requests[2].repairTerms).toEqual(["bereitstellen"]);
      expect(result.translated).toBe(STRIPPED);
      expect(result.metadata.keptWord).toBeUndefined();
    });

    it("strips the tag when the check fails, and surfaces a cancellation", async () => {
      const requests: any[] = [];
      const fail = () => {
        throw new TlError("TRANSLATION_FAILED", "boom", "hint");
      };
      const result = await runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, fail], requests), store, { glossaryEntries: [deploy] });
      expect(requests).toHaveLength(3);
      expect(result.translated).toBe(STRIPPED);
      expect(result.metadata.tagChecked).toBe(true);

      const cancel = () => {
        throw new TlError("CANCELLED", "Translation cancelled", "hint");
      };
      await expect(runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, cancel], []), store, { glossaryEntries: [deploy] })).rejects.toMatchObject({ tag: "CANCELLED" });

      // Aborted during the check, failing with a non-cancel error.
      const controller = new AbortController();
      const abortThrow = () => {
        controller.abort();
        throw new Error("socket closed");
      };
      await expect(runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, abortThrow], []), store, { glossaryEntries: [deploy], signal: controller.signal })).rejects.toMatchObject({ tag: "CANCELLED" });

      // Aborted before the check: it never starts.
      const before = new AbortController();
      const beforeRequests: any[] = [];
      const abortAfter = () => {
        before.abort();
        return AUTO_RAW;
      };
      await expect(runPipeline(AUTO_TEXT, "en", "de", checkAdapter([abortAfter, KEPT], beforeRequests), store, { glossaryEntries: [deploy], signal: before.signal })).rejects.toMatchObject({ tag: "CANCELLED" });
      expect(beforeRequests).toHaveLength(1);
    });

    it("checks in strict mode too", async () => {
      const requests: any[] = [];
      const result = await runPipeline(AUTO_TEXT, "en", "de", checkAdapter([AUTO_RAW, KEPT], requests), store, { glossaryEntries: [deploy], glossaryMode: "strict" });
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe(KEPT);
    });

    it("checks only the attempt prefer mode returns, never the code-switched one", async () => {
      const text = "Deploy the branch automatically after each commit.";
      const raw = '<term translation="bereitstellen">Automatisch</term> nach jedem Commit bereitstellen.';
      const opts = { glossaryEntries: [deploy, branch] };

      // The triggering first attempt misses Zweig; the second covers both and is returned unchecked.
      const covered: any[] = [];
      const second = await runPipeline(text, "en", "de", checkAdapter([raw, "Den Zweig nach jedem Commit automatisch bereitstellen."], covered), store, opts);
      expect(covered).toHaveLength(2);
      expect(covered[1].glossaryReminder).toEqual([{ source: "branch", target: "Zweig" }]);
      expect(second.metadata.tagChecked).toBeUndefined();

      // The first attempt wins on coverage after both retries (the code-switched one ties):
      // the code-switched attempt's output, which had the check's source, decides with no extra call.
      const best: any[] = [];
      const kept = await runPipeline(text, "en", "de", checkAdapter([raw, "miss", KEPT], best), store, opts);
      expect(best).toHaveLength(3);
      expect(best[2].source).toBe('<term translation="bereitstellen">bereitstellen</term> the <term translation="Zweig">Zweig</term> automatically after each commit.');
      expect(kept.translated).toBe(KEPT);
      expect(kept.glossaryCoverage).toBe(0.5);
      expect(kept.missingTerms).toEqual(["branch"]);
      expect(kept.metadata.retries).toBe(2);
      expect(kept.metadata.keptWord).toBe(true);
      expect(kept.metadata.tagChecked).toBeUndefined();

      // When that output lacks the word, the tag is stripped and the forced term repaired.
      const stripped: any[] = [];
      const strip = await runPipeline(text, "en", "de", checkAdapter([raw, "miss", "miss"], stripped), store, opts);
      expect(stripped).toHaveLength(4);
      expect(stripped[3].repairTerms).toEqual(["bereitstellen"]);
      expect(strip.translated).toBe(STRIPPED);
      expect(strip.glossaryCoverage).toBe(0.5);
      expect(strip.metadata.keptWord).toBeUndefined();

      // The code-switched attempt had the check's source: no check, it is repaired as forced.
      const switched: any[] = [];
      const last = await runPipeline(AUTO_TEXT, "en", "de", checkAdapter(["miss", "miss", AUTO_RAW], switched), store, { glossaryEntries: [deploy] });
      expect(switched).toHaveLength(4);
      expect(switched[3].repairTerms).toEqual(["bereitstellen"]);
      expect(last.metadata.tagChecked).toBeUndefined();
    });

    it("one check decides each candidate on its own", async () => {
      const host = { id: "h", sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" };
      const token = { id: "t", sourceTerm: "token", targetTerm: "jeton", sourceLang: "en", targetLang: "fr" };
      const raw = 'Redémarrez le <term translation="hôte">serveur</term> de l\'hôte et renouvelez la <term translation="jeton">clé</term> du jeton.';
      const requests: any[] = [];
      const result = await runPipeline("Restart the host server and renew the token key.", "en", "fr", checkAdapter([raw, "Redémarrez le serveur de l'hôte et renouvelez le jeton."], requests), store, { glossaryEntries: [host, token] });
      // serveur is kept, clé is replaced: the jeton tag is still a substitution, so the repair runs.
      expect(requests).toHaveLength(3);
      expect(requests[2].repairTerms).toEqual(["hôte", "jeton"]);
      expect(result.translated).toBe("Redémarrez le serveur de l'hôte et renouvelez la jeton du jeton.");
      expect(result.glossaryCoverage).toBe(1);
      expect(result.metadata.keptWord).toBe(true);
    });

    it("a word of a multi-word term in the check does not keep the tagged word", async () => {
      const pr = { id: "p", sourceTerm: "pull request", targetTerm: "Pull Request", sourceLang: "en", targetLang: "de" };
      const raw = 'Öffnen Sie einen Pull Request für die <term translation="Pull Request">Request</term>-Prüfung.';
      for (const [check, translated] of [
        ["Öffnen Sie einen Pull Request zur Prüfung.", "Öffnen Sie einen Pull Request für die Pull Request-Prüfung."],
        ["Öffnen Sie einen Pull Request für die Request-Prüfung.", "Öffnen Sie einen Pull Request für die Request-Prüfung."],
      ]) {
        const result = await runPipeline("Open a pull request for review.", "en", "de", checkAdapter([raw, check], []), store, { glossaryEntries: [pr] });
        expect(result.translated).toBe(translated);
      }
    });

    it("no check for a term hit twice, or with MockAdapter", async () => {
      const requests: any[] = [];
      await runPipeline("Deploy automatically, then deploy again.", "en", "de", checkAdapter([AUTO_RAW], requests), store, { glossaryEntries: [deploy] });
      expect(requests).toHaveLength(2);
      expect(requests[1].repairTerms).toBeDefined();

      const calls: any[] = [];
      const mock = new MockAdapter();
      const spy = { async translate(req: any) { calls.push(req); return mock.translate(req); }, async dispose() {} } as any;
      const result = await runPipeline("Please deploy automatically after each commit.", "en", "de", spy, store, { glossaryEntries: [deploy] });
      expect(calls).toHaveLength(1);
      expect(result.metadata.tagChecked).toBeUndefined();
    });
  });

  describe("drift check", () => {
    const cache = { id: "c", sourceTerm: "cache", targetTerm: "antémémoire", sourceLang: "en", targetLang: "fr" };
    const host = { id: "h", sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" };
    const TEXT = "Cache hit rate";
    const RAW = '<term translation="antémémoire">Taux de réussite</term>';
    const CHECK_SOURCE = '<term translation="antémémoire">antémémoire</term> hit rate';
    const CHECK = '<term translation="antémémoire">antémémoire</term> : taux de réussite';

    function driftAdapter(translations: string[], requests: any[], repair?: string) {
      let n = 0;
      return {
        name: "drift",
        async translate(req: any) {
          requests.push(req);
          const translated = req.repairTerms ? (repair ?? req.source) : translations[n++];
          if (translated === undefined) throw new Error(`unexpected request ${requests.length}`);
          return { translated, metadata: { adapter: "drift", durationMs: 0 } };
        },
        async dispose() {},
      } as any;
    }

    it("returns the check's output when it still writes the drifted words, then repairs it", async () => {
      const requests: any[] = [];
      const controller = new AbortController();
      const result = await runPipeline(TEXT, "en", "fr", driftAdapter([RAW, CHECK], requests, "Antémémoire : le taux de réussite"), store, {
        glossaryEntries: [cache], signal: controller.signal, contextSnippets: ["x"],
      });
      expect(requests).toHaveLength(3);
      expect(requests[1].source).toBe(CHECK_SOURCE);
      expect(requests[1].contextSnippets).toBeUndefined();
      expect(requests[1].signal).toBe(controller.signal);
      expect(requests[2].repairTerms).toEqual(["antémémoire"]);
      // The draft (`Antémémoire`) starts uppercase: so does the answer sent to the repair.
      expect(requests[2].source).toBe("Antémémoire : taux de réussite");
      expect(result.translated).toBe("Antémémoire : le taux de réussite");
      expect(result.glossaryCoverage).toBe(1);
      expect(result.metadata.tagChecked).toBe(true);
      expect(result.metadata.tagDrift).toBe(true);
      expect(result.metadata.repaired).toBe(true);
    });

    it("strips as before when the check doesn't write the drifted words or lacks the term", async () => {
      for (const check of ["antémémoire", "Taux de réussite"]) {
        const requests: any[] = [];
        const result = await runPipeline(TEXT, "en", "fr", driftAdapter([RAW, check], requests), store, { glossaryEntries: [cache] });
        expect(requests).toHaveLength(3);
        expect(requests[2].repairTerms).toEqual(["antémémoire"]);
        expect(result.translated).toBe("Antémémoire");
        expect(result.metadata.tagChecked).toBe(true);
        expect(result.metadata.tagDrift).toBeUndefined();
      }
    });

    it("keeps the draft when the check's output loses another term or a placeholder", async () => {
      const text = "Restart the server and check the cache hit rate";
      const raw = 'Redémarrez l\'hôte et vérifiez <term translation="antémémoire">le taux de réussite</term>';
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "fr", driftAdapter([raw, "Redémarrez et vérifiez le taux de réussite de l'antémémoire"], requests), store, { glossaryEntries: [cache, host] });
      expect(requests).toHaveLength(3);
      expect(result.translated).toBe("Redémarrez l'hôte et vérifiez antémémoire");
      expect(result.metadata.tagDrift).toBeUndefined();

      const TOK = "__TLPH_0__";
      const sized = `Cache hit rate ${TOK}`;
      const sentinel = { entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "fr" }, startIndex: sized.indexOf(TOK), endIndex: sized.indexOf(TOK) + TOK.length };
      const tagged = `${RAW} <term translation="${TOK}">${TOK}</term>`;
      for (const [check, translated] of [[CHECK, `Antémémoire ${TOK}`], [`${CHECK} ${TOK}`, `Antémémoire : taux de réussite ${TOK}`]]) {
        const result = await runPipeline(sized, "en", "fr", driftAdapter([tagged, check], []), store, { glossaryEntries: [cache], extraGlossaryHits: [sentinel] });
        expect(result.translated).toBe(translated);
      }
    });

    it("no check for one drifted word, or for the code-switched attempt", async () => {
      const requests: any[] = [];
      const result = await runPipeline("Commit message", "en", "fr", driftAdapter(['<term translation="validation">Message</term> de commit'], requests), store, {
        glossaryEntries: [{ id: "v", sourceTerm: "commit", targetTerm: "validation", sourceLang: "en", targetLang: "fr" }],
      });
      expect(requests).toHaveLength(2);
      expect(requests[1].repairTerms).toBeDefined();
      expect(result.metadata.tagChecked).toBeUndefined();

      const switched: any[] = [];
      await runPipeline(TEXT, "en", "fr", driftAdapter(["miss", "miss", RAW], switched), store, { glossaryEntries: [cache] });
      expect(switched).toHaveLength(4);
      expect(switched[3].repairTerms).toBeDefined();
    });

    it("keeps the check's output when the repair is rejected, in strict mode too", async () => {
      for (const glossaryMode of ["prefer", "strict"] as const) {
        const requests: any[] = [];
        const result = await runPipeline(TEXT, "en", "fr", driftAdapter([RAW, CHECK], requests), store, { glossaryEntries: [cache], glossaryMode });
        expect(requests).toHaveLength(3);
        expect(result.translated).toBe("Antémémoire : taux de réussite");
        expect(result.metadata.tagDrift).toBe(true);
        expect(result.metadata.repaired).toBeUndefined();
      }
    });

    it("starts the check's output uppercase only when the draft does", async () => {
      // A lowercase drifted span strips to a lowercase draft: the answer keeps its case.
      const lower = await runPipeline(TEXT, "en", "fr", driftAdapter([RAW.replace("Taux", "taux"), CHECK], []), store, { glossaryEntries: [cache] });
      expect(lower.translated).toBe("antémémoire : taux de réussite");
      expect(lower.metadata.tagDrift).toBe(true);
      // Text before the first letter stays; only that letter is raised.
      const quoted = await runPipeline(TEXT, "en", "fr", driftAdapter([`« Le ${RAW} »`, `« ${CHECK} »`], []), store, { glossaryEntries: [cache] });
      expect(quoted.translated).toBe("« Antémémoire : taux de réussite »");
      expect(quoted.metadata.tagDrift).toBe(true);
      // A term spelled lowercase-first (`iOS`) is not raised: the answer would lose it.
      const ios = { ...cache, targetTerm: "iOS" };
      const kept = await runPipeline(TEXT, "en", "fr", driftAdapter(['Le <term translation="iOS">taux de réussite</term>', "iOS : taux de réussite"], []), store, { glossaryEntries: [ios], glossaryMode: "strict" });
      expect(kept.translated).toBe("iOS : taux de réussite");
      expect(kept.glossaryCoverage).toBe(1);
      expect(kept.metadata.tagDrift).toBe(true);
      // The letter is raised in the target language's casing (Turkish `i` → `İ`).
      const tr = { ...cache, targetTerm: "önbellek", targetLang: "tr" };
      const turkish = await runPipeline(TEXT, "en", "tr", driftAdapter(['İşlem: <term translation="önbellek">isabet oranı</term>', "işlem: önbellek isabet oranı"], []), store, { glossaryEntries: [tr] });
      expect(turkish.translated).toBe("İşlem: önbellek isabet oranı");
      expect(turkish.metadata.tagDrift).toBe(true);
      // A target that is not a language tag falls back to plain casing.
      const odd = await runPipeline(TEXT, "en", "x!", driftAdapter([RAW, CHECK], []), store, { glossaryEntries: [{ ...cache, targetLang: "x!" }] });
      expect(odd.translated).toBe("Antémémoire : taux de réussite");
    });

    it("decides a drifted tag and a tag-check candidate from the one check", async () => {
      const text = "Restart the server and check the cache hit rate";
      const raw = 'Redémarrez le <term translation="hôte">serveur</term> de l\'hôte et vérifiez <term translation="antémémoire">le taux de réussite</term>';
      const opts = { glossaryEntries: [cache, host] };

      // The check covers both terms: its output is the answer, no word is kept.
      const swapped: any[] = [];
      const answer = "Redémarrez le serveur de l'hôte et vérifiez le taux de réussite de l'antémémoire";
      const swap = await runPipeline(text, "en", "fr", driftAdapter([raw, answer], swapped), store, opts);
      expect(swapped).toHaveLength(3);
      expect(swap.translated).toBe(answer);
      expect(swap.metadata.tagDrift).toBe(true);
      expect(swap.metadata.keptWord).toBeUndefined();

      // It loses antémémoire: no swap, but it still keeps `serveur`; the drifted tag is replaced and repaired.
      const kept: any[] = [];
      const keep = await runPipeline(text, "en", "fr", driftAdapter([raw, "Redémarrez le serveur de l'hôte et vérifiez le taux de réussite"], kept), store, opts);
      expect(kept).toHaveLength(3);
      expect(kept[2].repairTerms).toEqual(["hôte", "antémémoire"]);
      expect(keep.translated).toBe("Redémarrez le serveur de l'hôte et vérifiez antémémoire");
      expect(keep.metadata.keptWord).toBe(true);
      expect(keep.metadata.tagDrift).toBeUndefined();
    });

    it("an abort during the repair of the check's output surfaces as CANCELLED", async () => {
      const controller = new AbortController();
      let n = 0;
      const adapter = {
        async translate(req: any) {
          if (req.repairTerms) {
            controller.abort();
            throw new Error("socket closed");
          }
          return { translated: [RAW, CHECK][n++], metadata: { adapter: "x", durationMs: 0 } };
        },
        async dispose() {},
      } as any;
      await expect(runPipeline(TEXT, "en", "fr", adapter, store, { glossaryEntries: [cache], signal: controller.signal })).rejects.toMatchObject({ tag: "CANCELLED" });
    });

    it("reuses the code-switched retry's output, and surfaces a cancellation", async () => {
      // Prefer mode: the first attempt misses `hôte`, both retries too; the first wins and its drift is
      // decided by the code-switched retry's output with no extra call.
      const text = "Restart the server and check the cache hit rate";
      const raw = 'Redémarrez et vérifiez <term translation="antémémoire">le taux de réussite</term>';
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "fr", driftAdapter([raw, "miss", "Redémarrez et vérifiez le taux de réussite de l'antémémoire."], requests), store, { glossaryEntries: [cache, host] });
      expect(requests).toHaveLength(4);
      expect(requests[3].repairTerms).toEqual(["antémémoire"]);
      expect(result.translated).toBe("Redémarrez et vérifiez le taux de réussite de l'antémémoire");
      expect(result.metadata.tagDrift).toBe(true);
      expect(result.metadata.tagChecked).toBeUndefined();

      const cancelling = {
        async translate(req: any) {
          if (req.source === CHECK_SOURCE) throw new TlError("CANCELLED", "Translation cancelled", "hint");
          return { translated: RAW, metadata: { adapter: "x", durationMs: 0 } };
        },
        async dispose() {},
      } as any;
      await expect(runPipeline(TEXT, "en", "fr", cancelling, store, { glossaryEntries: [cache] })).rejects.toMatchObject({ tag: "CANCELLED" });
    });
  });

  describe("a full stop the source lacks", () => {
    function fixedAdapter(output: string, requests: any[] = []) {
      return {
        name: "fixed",
        async translate(req: any) {
          requests.push(req);
          return { translated: output, sourceLang: req.sourceLang, targetLang: req.targetLang, glossaryCoverage: 1, missingTerms: [], metadata: { adapter: "fixed", durationMs: 0, retries: 0 } };
        },
        async dispose() {},
      } as any;
    }

    it("keeps a full stop that ends a glossary term, and counts coverage on the returned text", async () => {
      store.add({ sourceTerm: "Acme", targetTerm: "Acme S.A.", sourceLang: "en", targetLang: "fr" });
      const kept = await runPipeline("Contact Acme", "en", "fr", fixedAdapter("Contactez Acme S.A."), store);
      expect(kept.translated).toBe("Contactez Acme S.A.");
      expect(kept.missingTerms).toEqual([]);

      // A glossary form ending in a full stop.
      store.add({ sourceTerm: "Globex", targetTerm: "Globex Groupe", sourceLang: "en", targetLang: "fr", forms: ["Globex Groupe."] });
      const form = await runPipeline("Contact Globex", "en", "fr", fixedAdapter("Contactez Globex Groupe."), store);
      expect(form.translated).toBe("Contactez Globex Groupe.");

      store.add({ sourceTerm: "server", targetTerm: "hôte", sourceLang: "en", targetLang: "fr" });
      const requests: any[] = [];
      const dropped = await runPipeline("Remove this server", "en", "fr", fixedAdapter("Supprimez cet hôte.", requests), store);
      expect(dropped.translated).toBe("Supprimez cet hôte");
      expect(dropped.missingTerms).toEqual([]);
      expect(requests).toHaveLength(1);
    });

    it("leaves image mode alone", async () => {
      const result = await runPipeline("", "en", "fr", fixedAdapter("Enregistrer les modifications."), store, { imageBase64: "dGVzdA==" });
      expect(result.translated).toBe("Enregistrer les modifications.");
    });
  });

  describe("extraGlossaryHits (tagging only)", () => {
    const TOK = "__TLPH_0__";
    const sentinelHit = (text: string) => ({
      entry: { id: "__sentinel_0", sourceTerm: TOK, targetTerm: TOK, sourceLang: "en", targetLang: "ar" },
      startIndex: text.indexOf(TOK),
      endIndex: text.indexOf(TOK) + TOK.length,
    });
    // Defers to MockAdapter (which substitutes glossary terms) but drops the
    // sentinel, and drops the real term too on the first `missFirst` calls.
    function dropSentinelAdapter(requests: any[], missFirst = 0) {
      const mock = new MockAdapter();
      return {
        name: "drop-sentinel",
        async translate(req: any) {
          requests.push(req);
          const res = await mock.translate(req);
          let translated = res.translated.split(TOK).join("");
          if (requests.length <= missFirst) translated = translated.split("واجهة برمجة").join("");
          return { ...res, translated };
        },
        async dispose() {},
      } as any;
    }

    it("tags extra hits but leaves them out of coverage and missingTerms", async () => {
      const text = `Hello ${TOK}`;
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests), store, { extraGlossaryHits: [sentinelHit(text)] });
      expect(requests[0].source).toContain(`<term translation="${TOK}">${TOK}</term>`);
      expect(requests[0].glossaryHits).toHaveLength(1);
      expect(result.translated).not.toContain(TOK);
      expect(result.glossaryCoverage).toBe(1);
      expect(result.missingTerms).toEqual([]);
    });

    it("strict mode neither retries nor throws for a dropped extra hit", async () => {
      const text = `Hello ${TOK}`;
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests), store, {
        glossaryMode: "strict", maxRetries: 2, extraGlossaryHits: [sentinelHit(text)],
      });
      expect(requests).toHaveLength(1);
      expect(result.metadata.retries).toBe(0);
      expect(result.missingTerms).toEqual([]);
    });

    it("prefer mode does not retry for a dropped extra hit", async () => {
      const text = `Hello ${TOK}`;
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests), store, {
        glossaryMode: "prefer", extraGlossaryHits: [sentinelHit(text)],
      });
      expect(requests).toHaveLength(1);
      expect(result.metadata.retries).toBe(0);
      expect(result.glossaryCoverage).toBe(1);
    });

    it("prefer-mode reminders name only real glossary terms", async () => {
      store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
      const text = `The API ${TOK}`;
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests, 1), store, {
        glossaryMode: "prefer", extraGlossaryHits: [sentinelHit(text)],
      });
      expect(requests).toHaveLength(2);
      expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
      expect(result.missingTerms).toEqual([]);
    });

    it("strict-mode reminders name only real glossary terms", async () => {
      store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
      const text = `The API ${TOK}`;
      const requests: any[] = [];
      const result = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests, 1), store, {
        glossaryMode: "strict", maxRetries: 2, extraGlossaryHits: [sentinelHit(text)],
      });
      expect(requests).toHaveLength(2);
      expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
      expect(result.missingTerms).toEqual([]);
    });

    it("strict mode still throws GLOSSARY_STRICT_MISS for a missing real term", async () => {
      store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
      const text = `The API ${TOK}`;
      const requests: any[] = [];
      const err = await runPipeline(text, "en", "ar", dropSentinelAdapter(requests, 99), store, {
        glossaryMode: "strict", maxRetries: 2, extraGlossaryHits: [sentinelHit(text)],
      }).catch((e) => e);
      expect(err).toBeInstanceOf(TlError);
      expect(err.tag).toBe("GLOSSARY_STRICT_MISS");
      expect(err.message).toContain("1 glossary term(s) missing");
      expect(err.message).not.toContain(TOK);
      expect(requests).toHaveLength(3);
      expect(requests[1].glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
      expect(requests[2].glossaryReminder).toBeUndefined();
    });

    it("the code-switched final retry keeps sentinel tags unchanged", async () => {
      store.add({ sourceTerm: "API", targetTerm: "واجهة برمجة", sourceLang: "en", targetLang: "ar" });
      const text = `The API ${TOK}`;
      const requests: any[] = [];
      await runPipeline(text, "en", "ar", dropSentinelAdapter(requests, 99), store, {
        glossaryMode: "prefer", extraGlossaryHits: [sentinelHit(text)],
      });
      expect(requests).toHaveLength(3);
      expect(requests[2].source).toBe(`The <term translation="واجهة برمجة" source="API">واجهة برمجة</term> <term translation="${TOK}">${TOK}</term>`);
    });
  });
});
