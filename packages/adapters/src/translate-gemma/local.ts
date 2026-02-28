import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";
import { computeGlossaryCoverage } from "@tl/shared/utils/text";
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
  response: string;
}

export class TranslateGemmaLocalAdapter implements Adapter {
  readonly name = "translate-gemma-local";

  constructor(
    private readonly model: string,
    private readonly endpoint: string
  ) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
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
          stream: false,
          ...(system ? { system } : {}),
          ...(request.imageBase64 ? { images: [request.imageBase64] } : {}),
        } satisfies OllamaGenerateRequest),
      });
    } catch (err) {
      throw new TlError(
        "ADAPTER_UNAVAILABLE",
        `Ollama is not reachable at ${this.endpoint}`,
        "Ensure Ollama is running: ollama serve",
        err
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TlError(
        "TRANSLATION_FAILED",
        `Ollama returned HTTP ${response.status}: ${body}`,
        "Check that the model is available: ollama list"
      );
    }

    const data = (await response.json()) as OllamaGenerateResponse;
    const translated = data.response.trim();

    const { glossaryCoverage, missingTerms } = computeGlossaryCoverage(
      request.glossaryHits ?? [],
      translated
    );

    return {
      translated,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      glossaryCoverage,
      missingTerms,
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
      });
    } catch {
      // Best-effort: ignore errors on dispose
    }
  }
}
