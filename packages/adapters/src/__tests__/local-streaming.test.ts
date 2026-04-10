import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { TlError } from "@translate-local/shared/errors";
import type { TranslationRequest } from "@translate-local/shared/types";

const ENDPOINT = "http://localhost:11434";

const makeRequest = (overrides?: Partial<TranslationRequest>): TranslationRequest => ({
  source: "Hello",
  sourceLang: "en",
  targetLang: "ar",
  onChunk: () => {},
  ...overrides,
});

/** Helper: build a ReadableStream from NDJSON lines */
function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.map((l) => encoder.encode(l + "\n"));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < data.length) {
        controller.enqueue(data[i++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Helper: build a stream that errors mid-read */
function errorStream(linesBeforeError: string[], error: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = linesBeforeError.map((l) => encoder.encode(l + "\n"));
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < data.length) {
        controller.enqueue(data[i++]);
      } else {
        controller.error(error);
      }
    },
  });
}

const originalFetch = globalThis.fetch;

function mockFetch(body: ReadableStream<Uint8Array>) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(body, { status: 200 }))
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TranslateGemmaLocalAdapter streaming", () => {
  test("reader error is caught and wrapped in TlError", async () => {
    const stream = errorStream(
      ['{"response":"partial","done":false}'],
      new Error("network disconnected")
    );
    mockFetch(stream);

    const adapter = new TranslateGemmaLocalAdapter("test-model", ENDPOINT);
    try {
      await adapter.translate(makeRequest());
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TlError);
      const tlErr = err as TlError;
      expect(tlErr.tag).toBe("TRANSLATION_FAILED");
      expect(tlErr.message).toContain("Stream interrupted");
      expect(tlErr.message).toContain("network disconnected");
    }
  });

  test("accumulated response exceeding 10 MB throws TlError", async () => {
    // Create a stream that sends a huge chunk
    const bigChunk = "x".repeat(11 * 1024 * 1024);
    const stream = ndjsonStream([
      JSON.stringify({ response: bigChunk, done: false }),
      JSON.stringify({ response: "", done: true }),
    ]);
    mockFetch(stream);

    const adapter = new TranslateGemmaLocalAdapter("test-model", ENDPOINT);
    try {
      await adapter.translate(makeRequest());
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TlError);
      const tlErr = err as TlError;
      expect(tlErr.tag).toBe("TRANSLATION_FAILED");
      expect(tlErr.message).toContain("10M character");
    }
  });

  test("successful streaming accumulates and returns full response", async () => {
    const stream = ndjsonStream([
      '{"response":"مرحبا","done":false}',
      '{"response":" بالعالم","done":false}',
      '{"response":"","done":true}',
    ]);
    mockFetch(stream);

    const chunks: string[] = [];
    const adapter = new TranslateGemmaLocalAdapter("test-model", ENDPOINT);
    const result = await adapter.translate(
      makeRequest({ onChunk: (c) => chunks.push(c) })
    );

    expect(result.translated).toBe("مرحبا بالعالم");
    expect(chunks).toEqual(["مرحبا", " بالعالم"]);
  });
});
