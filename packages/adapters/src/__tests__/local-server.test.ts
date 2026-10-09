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

  test("non-stream: a 200 body without a string response throws TlError", async () => {
    const endpoint = serveJson({ error: "model 'm' not found" });
    const err = await translateError(new TranslateGemmaLocalAdapter("m", endpoint), makeRequest());
    expect(err.tag).toBe("TRANSLATION_FAILED");
    expect(err.message).toContain("model 'm' not found");
  });

  test("non-stream: success returns the trimmed response", async () => {
    const endpoint = serveJson({ response: "  مرحبا \n", done: true });
    const result = await new TranslateGemmaLocalAdapter("m", endpoint).translate(makeRequest());
    expect(result.translated).toBe("مرحبا");
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

  test("process exits promptly after streaming success, stream error and non-stream success", async () => {
    let n = 0;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { stream: boolean };
        if (!body.stream) return Response.json({ response: "x", done: true });
        n++;
        return new Response(n === 1 ? line({ response: "x", done: false }) + line({ done: true }) : line({ error: "boom" }));
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
