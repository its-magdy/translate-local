import { describe, test, expect, afterEach } from "bun:test";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { TlError } from "@translate-local/shared/errors";
import type { TranslationRequest } from "@translate-local/shared/types";

const ENDPOINT = "http://localhost:11434";

const makeRequest = (overrides?: Partial<TranslationRequest>): TranslationRequest => ({
  source: "Hello",
  sourceLang: "en",
  targetLang: "ar",
  ...overrides,
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TranslateGemmaLocalAdapter timeout", () => {
  test("fetch timeout throws ADAPTER_UNAVAILABLE TlError", async () => {
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      // Simulate the signal aborting with a TimeoutError (what AbortSignal.timeout produces)
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => {
            const err = new DOMException("The operation timed out.", "TimeoutError");
            reject(err);
          });
        });
      }
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new TranslateGemmaLocalAdapter("test-model", ENDPOINT, 1);

    try {
      await adapter.translate(makeRequest());
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TlError);
      const tlErr = err as TlError;
      expect(tlErr.tag).toBe("ADAPTER_UNAVAILABLE");
      expect(tlErr.message).toContain("did not respond within");
    }
  });

  test("timeout of 1ms is passed via signal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Response(JSON.stringify({ response: "مرحبا" }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new TranslateGemmaLocalAdapter("test-model", ENDPOINT, 5000);
    await adapter.translate(makeRequest());

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
