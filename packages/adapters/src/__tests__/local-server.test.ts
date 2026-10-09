import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "bun";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { TlError } from "@translate-local/shared/errors";
import type { TranslationRequest } from "@translate-local/shared/types";

// End-to-end against a fake Ollama served by Bun.serve, so real fetch and
// real body streaming (including aborts) are exercised.

const makeRequest = (overrides?: Partial<TranslationRequest>): TranslationRequest => ({
  source: "Hello",
  sourceLang: "en",
  targetLang: "ar",
  ...overrides,
});

const streaming = (chunks: string[] = []) =>
  makeRequest({ onChunk: (c) => chunks.push(c) });

let server: Server<undefined> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

/** Serve `/api/generate` with a body made of `parts`, each sent after its delay. */
function serveParts(parts: { delayMs?: number; text: string }[], close = true): string {
  server = Bun.serve({
    port: 0,
    fetch() {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const p of parts) {
            if (p.delayMs) await Bun.sleep(p.delayMs);
            try {
              controller.enqueue(encoder.encode(p.text));
            } catch {
              return; // client went away
            }
          }
          if (close) controller.close();
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    },
  });
  return `http://localhost:${server.port}`;
}

function serveJson(body: unknown, delayMs = 0): string {
  server = Bun.serve({
    port: 0,
    async fetch() {
      if (delayMs) await Bun.sleep(delayMs);
      return Response.json(body);
    },
  });
  return `http://localhost:${server.port}`;
}

async function translateError(adapter: TranslateGemmaLocalAdapter, req: TranslationRequest): Promise<TlError> {
  try {
    await adapter.translate(req);
  } catch (err) {
    expect(err).toBeInstanceOf(TlError);
    return err as TlError;
  }
  throw new Error("translate should have thrown");
}

const line = (o: unknown) => JSON.stringify(o) + "\n";

describe("TranslateGemmaLocalAdapter against a fake Ollama", () => {
  test("streaming: a mid-stream error line throws TRANSLATION_FAILED", async () => {
    const endpoint = serveParts([
      { text: line({ response: "مرح", done: false }) },
      { text: line({ error: "model runner has unexpectedly stopped" }) },
    ]);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), streaming());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("model runner has unexpectedly stopped");
    expect(err.hint).toBeTruthy();
  });

  test("streaming: an error line without a trailing newline still throws", async () => {
    const endpoint = serveParts([{ text: JSON.stringify({ error: "out of memory" }) }]);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), streaming());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("out of memory");
  });

  test("streaming: a stream ending without done:true throws", async () => {
    const endpoint = serveParts([{ text: line({ response: "partial", done: false }) }]);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), streaming());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("stream ended before completion");
  });

  test("streaming: completes when total time exceeds the timeout but tokens keep flowing", async () => {
    const endpoint = serveParts([
      { text: line({ response: "a", done: false }) },
      { delayMs: 120, text: line({ response: "b", done: false }) },
      { delayMs: 120, text: line({ response: "c", done: false }) },
      { delayMs: 120, text: line({ response: "", done: true }) },
    ]);
    const chunks: string[] = [];
    const result = await new TranslateGemmaLocalAdapter("m", endpoint, 250).translate(streaming(chunks));
    expect(result.translated).toBe("abc");
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  test("streaming: a stalled stream times out with the 'did not respond' message", async () => {
    const endpoint = serveParts([{ text: line({ response: "a", done: false }) }], false);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint, 150), streaming());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("did not respond within 150ms");
  });

  test("no response headers within the timeout throws ADAPTER_UNAVAILABLE", async () => {
    const endpoint = serveJson({ response: "late" }, 500);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint, 100), makeRequest());
    expect(err.tag).toBe("ADAPTER_UNAVAILABLE");
    expect(err.message).toContain("did not respond within 100ms");
  });

  test("without onChunk: Ollama is still asked to stream and the result is returned", async () => {
    let requested: { stream?: boolean } | undefined;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        requested = (await req.json()) as { stream?: boolean };
        return new Response(line({ response: "  مرح", done: false }) + line({ response: "با \n", done: false }) + line({ done: true }));
      },
    });
    const result = await new TranslateGemmaLocalAdapter("m", `http://localhost:${server.port}`).translate(makeRequest());
    expect(requested?.stream).toBe(true);
    expect(result.translated).toBe("مرحبا");
  });

  test("without onChunk: tokens keep the idle timer alive past the timeout", async () => {
    const endpoint = serveParts([
      { text: line({ response: "a", done: false }) },
      { delayMs: 120, text: line({ response: "b", done: false }) },
      { delayMs: 120, text: line({ response: "", done: true }) },
    ]);
    const result = await new TranslateGemmaLocalAdapter("m", endpoint, 200).translate(makeRequest());
    expect(result.translated).toBe("ab");
  });

  test("without onChunk: an error body throws TRANSLATION_FAILED", async () => {
    const endpoint = serveJson({ error: "model 'm' not found" });
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), makeRequest());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("model 'm' not found");
  });

  test("a caller abort mid-stream throws CANCELLED, not a timeout", async () => {
    const endpoint = serveParts([{ text: line({ response: "a", done: false }) }], false);
    const controller = new AbortController();
    const req = makeRequest({ signal: controller.signal, onChunk: () => controller.abort() });
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint, 5000), req);
    expect(err.tag).toBe("CANCELLED");
  });

  test("a caller abort before headers throws CANCELLED", async () => {
    const endpoint = serveJson({ response: "late" }, 2000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const start = Date.now();
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint, 5000), makeRequest({ signal: controller.signal }));
    expect(err.tag).toBe("CANCELLED");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("an already-aborted signal throws CANCELLED", async () => {
    const endpoint = serveJson({ response: "x", done: true });
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), makeRequest({ signal: AbortSignal.abort() }));
    expect(err.tag).toBe("CANCELLED");
  });

  test("without onChunk: a stalled stream times out", async () => {
    const endpoint = serveParts([{ text: line({ response: "a", done: false }) }], false);
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint, 150), makeRequest());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("did not respond within 150ms");
  });
});

describe("TranslateGemmaLocalAdapter timer cleanup", () => {
  // A dangling timeout timer would keep a short-lived CLI process alive (or
  // fire later). Spawn a child that translates once with a long timeout and
  // check it exits promptly, for success and failure paths.
  const script = (endpoint: string, stream: boolean) => `
    import { TranslateGemmaLocalAdapter } from ${JSON.stringify(import.meta.dir + "/../translate-gemma/local.ts")};
    const a = new TranslateGemmaLocalAdapter("m", ${JSON.stringify(endpoint)}, 20000);
    try {
      const r = await a.translate({ source: "Hello", sourceLang: "en", targetLang: "ar"${stream ? ", onChunk: () => {}" : ""} });
      console.log("ok:" + r.translated);
    } catch (e) { console.log("err:" + e.tag); }
  `;

  async function runChild(endpoint: string, stream: boolean): Promise<{ out: string; ms: number }> {
    const start = Date.now();
    const proc = Bun.spawn([process.execPath, "-e", script(endpoint, stream)], { stdout: "pipe", stderr: "inherit" });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return { out, ms: Date.now() - start };
  }

  test("process exits promptly after success with onChunk, stream error, and success without onChunk", async () => {
    let n = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        n++;
        return new Response(n === 2 ? line({ error: "boom" }) : line({ response: "x", done: false }) + line({ done: true }));
      },
    });
    const endpoint = `http://localhost:${server.port}`;
    for (const [stream, expected] of [[true, "ok:x"], [true, "err:TRANSLATION_FAILED"], [false, "ok:x"]] as const) {
      const { out, ms } = await runChild(endpoint, stream);
      expect(out).toBe(expected);
      expect(ms).toBeLessThan(10_000);
    }
  }, 30_000);
});
