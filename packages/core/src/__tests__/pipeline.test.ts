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
    expect(calls).toBe(1);
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

  describe("prefer-mode reminder retry", () => {
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

    it("keeps the first result on a tie and never throws", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API is ready", "en", "ar", scriptedAdapter(["first miss", "second miss"], requests), store, {
        glossaryMode: "prefer", maxRetries: 5,
      });
      expect(requests).toHaveLength(2);
      expect(result.translated).toBe("first miss");
      expect(result.missingTerms).toEqual(["API"]);
      expect(result.metadata.retries).toBe(1);
    });

    it("keeps the first result when the retry covers fewer terms", async () => {
      const requests: any[] = [];
      const result = await runPipeline("The API server", "en", "ar", scriptedAdapter(["first واجهة", "second miss"], requests), store, { glossaryMode: "prefer" });
      expect(requests).toHaveLength(2);
      expect(requests[1].glossaryReminder).toEqual([{ source: "server", target: "خادم" }]);
      expect(result.translated).toBe("first واجهة");
      expect(result.glossaryCoverage).toBe(0.5);
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
      for (const req of requests.slice(1)) expect(req.glossaryReminder).toEqual([{ source: "API", target: "واجهة برمجة" }]);
    });
  });
});
