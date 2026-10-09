import type { Adapter, TranslationRequest, TranslationResult } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { DEFAULT_OLLAMA_TIMEOUT_MS } from "@translate-local/shared/constants";
import { buildStructuredPrompt } from "../base";

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: boolean;
  system?: string;
  images?: string[];
  keep_alive?: number;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

interface OllamaStreamChunk {
  response?: string;
  done?: boolean;
  error?: string;
}

const OLLAMA_ERROR_HINT = "Check the Ollama server logs and that the model is available: ollama list";

export class TranslateGemmaLocalAdapter implements Adapter {
  readonly name = "translate-gemma-local";

  constructor(
    private readonly model: string,
    private readonly endpoint: string,
    private readonly timeoutMs: number = DEFAULT_OLLAMA_TIMEOUT_MS
  ) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    // Idle timeout: bounds how long we wait for Ollama to send *something*
    // (headers, then each body chunk), not the total generation time, so a
    // long translation that keeps streaming tokens is never cut off.
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resetTimer = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
    };
    resetTimer();
    try {
      return await this.generate(request, controller.signal, resetTimer, () => timedOut);
    } finally {
      clearTimeout(timer);
    }
  }

  private timeoutError(tag: "ADAPTER_UNAVAILABLE" | "TRANSLATION_FAILED"): TlError {
    return new TlError(
      tag,
      `Ollama did not respond within ${this.timeoutMs}ms`,
      "Check that Ollama is running and not overloaded: ollama serve"
    );
  }

  private async generate(
    request: TranslationRequest,
    signal: AbortSignal,
    resetTimer: () => void,
    timedOut: () => boolean
  ): Promise<TranslationResult> {
    const start = Date.now();
    const { prompt, system } = buildStructuredPrompt(request);

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: !!request.onChunk,
          ...(system ? { system } : {}),
          ...(request.imageBase64 ? { images: [request.imageBase64] } : {}),
        } satisfies OllamaGenerateRequest),
        signal,
      });
    } catch (err) {
      if (timedOut() || (err instanceof DOMException && err.name === "TimeoutError")) {
        throw this.timeoutError("ADAPTER_UNAVAILABLE");
      }
      throw new TlError(
        "ADAPTER_UNAVAILABLE",
        `Ollama is not reachable at ${this.endpoint}`,
        "Ensure Ollama is running: ollama serve",
        err
      );
    }
    resetTimer();

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TlError(
        "TRANSLATION_FAILED",
        `Ollama returned HTTP ${response.status}: ${body}`,
        "Check that the model is available: ollama list"
      );
    }

    let translated: string;

    if (request.onChunk) {
      // Streaming: read NDJSON line by line
      if (!response.body) {
        throw new TlError("TRANSLATION_FAILED", "No response body for streaming", "Check Ollama version");
      }
      const MAX_ACCUMULATED_CHARS = 10 * 1024 * 1024; // 10M character safety limit
      const onChunk = request.onChunk;
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let lineBuffer = "";
      let accumulated = "";
      let completed = false;

      const handleLine = (line: string): void => {
        if (!line.trim()) return;
        let chunk: OllamaStreamChunk;
        try {
          chunk = JSON.parse(line) as OllamaStreamChunk;
        } catch {
          throw new TlError("TRANSLATION_FAILED", `Malformed streaming response from Ollama: ${line}`, "Check Ollama version or restart Ollama");
        }
        // Ollama reports mid-stream failures as an {"error": "..."} line on a 200 response
        if (chunk.error !== undefined) {
          throw new TlError("TRANSLATION_FAILED", `Ollama error: ${chunk.error}`, OLLAMA_ERROR_HINT);
        }
        if (chunk.response) {
          onChunk(chunk.response);
          accumulated += chunk.response;
          if (accumulated.length > MAX_ACCUMULATED_CHARS) {
            throw new TlError("TRANSLATION_FAILED", "Streaming response exceeded 10M character limit", "The model produced an unexpectedly large response");
          }
        }
        if (chunk.done) completed = true;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetTimer();
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";
          for (const line of lines) handleLine(line);
        }
      } catch (err) {
        if (err instanceof TlError) throw err;
        if (timedOut()) throw this.timeoutError("TRANSLATION_FAILED");
        throw new TlError(
          "TRANSLATION_FAILED",
          `Stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
          "Check network connectivity and Ollama status",
          err
        );
      } finally {
        reader.releaseLock();
      }
      handleLine(lineBuffer); // flush remaining buffer
      if (!completed) {
        throw new TlError(
          "TRANSLATION_FAILED",
          "Ollama stream ended before completion",
          OLLAMA_ERROR_HINT
        );
      }
      translated = accumulated.trim();
    } else {
      // Non-stream mode only gets a body once generation finishes, so the idle
      // timer cannot be reset per token here: it bounds the wait for the body.
      let data: OllamaGenerateResponse;
      try {
        data = (await response.json()) as OllamaGenerateResponse;
      } catch (err) {
        if (timedOut()) throw this.timeoutError("TRANSLATION_FAILED");
        throw new TlError(
          "TRANSLATION_FAILED",
          `Malformed response from Ollama: ${err instanceof Error ? err.message : String(err)}`,
          "Check Ollama version or restart Ollama",
          err
        );
      }
      if (typeof data?.response !== "string") {
        const detail = data?.error !== undefined ? `Ollama error: ${data.error}` : "Ollama response has no text";
        throw new TlError("TRANSLATION_FAILED", detail, OLLAMA_ERROR_HINT);
      }
      translated = data.response.trim();
    }

    return {
      translated,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      // Real coverage is computed by the pipeline on the postprocessed text;
      // an adapter only sees the pre-strip output.
      glossaryCoverage: 1,
      missingTerms: [],
      metadata: {
        adapter: this.name,
        durationMs: Date.now() - start,
        retries: 0,
      },
    };
  }

  async dispose(): Promise<void> {
    // Unload model from VRAM by sending keep_alive: 0
    try {
      await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: "",
          stream: false,
          keep_alive: 0,
        } satisfies OllamaGenerateRequest),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Best-effort: ignore errors on dispose
    }
  }
}
