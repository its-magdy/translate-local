import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";
import { buildStructuredPrompt } from "../base";

const HF_API_URL = "https://api-inference.huggingface.co/models";

interface HFTextGenerationResponse {
  generated_text: string;
}

function resolveToken(token: string): string {
  // Support ${ENV_VAR} syntax
  return token.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

export class TranslateGemmaHFAdapter implements Adapter {
  readonly name = "translate-gemma-huggingface";
  private readonly resolvedToken: string;

  constructor(
    private readonly model: string,
    token: string
  ) {
    this.resolvedToken = resolveToken(token);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();
    const prompt = buildStructuredPrompt(request);

    if (!this.resolvedToken) {
      throw new TlError(
        "ADAPTER_UNAVAILABLE",
        "HuggingFace token is not set",
        "Set the HF_TOKEN environment variable or configure hfToken in your config"
      );
    }

    let response: Response;
    try {
      response = await fetch(`${HF_API_URL}/${this.model}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.resolvedToken}`,
        },
        body: JSON.stringify({ inputs: prompt }),
      });
    } catch (err) {
      throw new TlError(
        "ADAPTER_UNAVAILABLE",
        "Could not reach HuggingFace API",
        "Check your internet connection",
        err
      );
    }

    if (response.status === 401) {
      throw new TlError(
        "ADAPTER_UNAVAILABLE",
        "HuggingFace authentication failed",
        "Check that your HF_TOKEN is valid"
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TlError(
        "TRANSLATION_FAILED",
        `HuggingFace API returned HTTP ${response.status}: ${body}`,
        "See https://huggingface.co/docs/api-inference for details"
      );
    }

    const data = (await response.json()) as HFTextGenerationResponse[];
    const raw = data[0]?.generated_text ?? "";

    // HF returns the full prompt + completion; extract just the translation
    const marker = "Translation:";
    const markerIdx = raw.lastIndexOf(marker);
    const translated = (markerIdx >= 0 ? raw.slice(markerIdx + marker.length) : raw).trim();

    const hits = request.glossaryHits ?? [];
    const missingTerms = hits
      .filter((h) => !translated.includes(h.entry.targetTerm))
      .map((h) => h.entry.sourceTerm);

    const glossaryCoverage =
      hits.length === 0 ? 1 : (hits.length - missingTerms.length) / hits.length;

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
    // no-op: HuggingFace manages model lifecycle
  }
}
