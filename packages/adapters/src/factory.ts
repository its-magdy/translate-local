import type { Adapter, AdapterConfig } from "@tl/shared/types";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "@tl/shared/constants";
import { MockAdapter } from "./mock";
import { TranslateGemmaLocalAdapter } from "./translate-gemma/local";

export function createAdapter(config: AdapterConfig): Adapter {
  const { backend, model = DEFAULT_MODEL } = config;

  switch (backend) {
    case "ollama":
      return new TranslateGemmaLocalAdapter(model, config.ollamaUrl ?? DEFAULT_OLLAMA_URL);

    default: {
      // Exhaustiveness check
      const _never: never = backend;
      throw new Error(`Unknown adapter backend: ${_never}`);
    }
  }
}

export function createMockAdapter(): Adapter {
  return new MockAdapter();
}
