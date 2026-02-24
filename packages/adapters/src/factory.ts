import type { Adapter, AdapterConfig } from "@tl/shared/types";
import { TlError } from "@tl/shared/errors";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "@tl/shared/constants";
import { MockAdapter } from "./mock";
import { TranslateGemmaLocalAdapter } from "./translate-gemma/local";
import { TranslateGemmaHFAdapter } from "./translate-gemma/huggingface";

export function createAdapter(config: AdapterConfig): Adapter {
  const { backend, model = DEFAULT_MODEL } = config;

  switch (backend) {
    case "ollama":
      return new TranslateGemmaLocalAdapter(model, config.ollamaUrl ?? DEFAULT_OLLAMA_URL);

    case "huggingface":
      if (!config.hfToken) {
        throw new TlError(
          "ADAPTER_UNAVAILABLE",
          "hfToken is required for the huggingface backend",
          "Set HF_TOKEN env var or add hfToken to your config"
        );
      }
      return new TranslateGemmaHFAdapter(model, config.hfToken);

    default: {
      // Exhaustiveness check
      const _never: never = backend;
      throw new TlError(
        "CONFIG_INVALID",
        `Unknown adapter backend: ${_never}`,
        "Valid backends are: ollama, huggingface"
      );
    }
  }
}

export function createMockAdapter(): Adapter {
  return new MockAdapter();
}
