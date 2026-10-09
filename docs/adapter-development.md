# Adapter Development

This guide explains how to implement a custom adapter for `tl`.

## The Adapter Interface

All adapters implement the `Adapter` interface from `@translate-local/shared/types`:

```typescript
export interface Adapter {
  translate(request: TranslationRequest): Promise<TranslationResult>;
  dispose(): Promise<void>;
}
```

### `TranslationRequest`

```typescript
export interface TranslationRequest {
  source: string;           // Text to translate (may include XML glossary tags)
  sourceLang: string;       // BCP-47 source language, e.g. "en"
  targetLang: string;       // BCP-47 target language, e.g. "ar"
  imageBase64?: string;     // Base64-encoded image for vision translation
  glossaryHits?: GlossaryHit[];      // Matched glossary entries
  contextSnippets?: string[];        // Relevant context passages
  onChunk?: (chunk: string) => void; // Streaming callback, one call per token
  signal?: AbortSignal;              // Caller cancellation
  options?: {
    glossaryMode?: "strict" | "prefer";
  };
}
```

### `TranslationResult`

```typescript
export interface TranslationResult {
  translated: string;       // The translated text
  sourceLang: string;
  targetLang: string;
  glossaryCoverage: number; // 0–1, computed by the pipeline (not the adapter)
  missingTerms: string[];   // Computed by the pipeline
  metadata: {
    adapter: string;        // Identifier string for this adapter
    durationMs: number;     // Wall-clock time of the translate() call
    retries: number;        // Set by the pipeline, not the adapter
  };
}
```

### Streaming (`onChunk`)

When `request.onChunk` is set, the pipeline wants tokens as they arrive. Streaming adapters request a streamed response from the backend, call `onChunk` for each token, and still accumulate the full text for `translated`. Adapters that don't support streaming can ignore the field. The pipeline passes `onChunk` on the first attempt only, so retries never concatenate tokens across attempts.

### Cancellation (`signal`)

When `request.signal` aborts (a superseded TUI translation, Ctrl+C in the CLI), stop the backend request (pass the signal to `fetch`) and throw `cancelledError()` from `@translate-local/shared/errors` (tag `CANCELLED`), so callers can tell a cancel from a timeout or backend failure. At minimum, throw it when the signal is already aborted on entry. The pipeline starts no further attempt once the signal is aborted.

### `dispose()`

Called when the adapter is no longer needed. Use it to release resources (close connections, unload models from VRAM). If your adapter has no resources to clean up, return `Promise.resolve()`.

---

## Prompt Utilities

`packages/adapters/src/base.ts` exports two prompt-building helpers:

```typescript
// For TranslateGemma models — returns { prompt, system? }
// Handles image mode automatically when request.imageBase64 is set
buildStructuredPrompt(request: TranslationRequest): { prompt: string; system?: string }

// For generic LLMs (natural language instructions) — returns a string
buildNaturalPrompt(request: TranslationRequest): string
```

`buildNaturalPrompt` injects glossary terms as bullet points and appends context snippets. Use it as a starting point for non-TranslateGemma adapters.

---

## The `createAdapter()` Factory

`packages/adapters/src/factory.ts` maps `AdapterConfig.backend` to a concrete adapter:

```typescript
export function createAdapter(config: AdapterConfig): Adapter {
  const { backend, model = DEFAULT_MODEL } = config;

  switch (backend) {
    case "ollama":
      return new TranslateGemmaLocalAdapter(model, config.ollamaUrl ?? DEFAULT_OLLAMA_URL);

    case "mock":
      return new MockAdapter();

    default: {
      // Exhaustiveness check
      const _never: never = backend;
      throw new TlError("CONFIG_INVALID", `Unknown adapter backend: ${_never}`, "Valid backends are: ollama, mock");
    }
  }
}
```

`mock` returns the deterministic `MockAdapter` (also available as `createMockAdapter()`); use it in tests so they don't need Ollama. To add a new backend type, add a case to this switch. The `never` check makes the build fail until every `AdapterBackend` member is handled.

---

## Step-by-Step: Creating a New Adapter

### 1. Create the adapter file

```typescript
// packages/adapters/src/my-service/index.ts
import type { Adapter, TranslationRequest, TranslationResult } from "@translate-local/shared/types";
import { buildNaturalPrompt } from "../base";

export class MyServiceAdapter implements Adapter {
  private client: MyServiceClient;

  constructor(private apiKey: string) {
    this.client = new MyServiceClient(apiKey);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();
    const prompt = buildNaturalPrompt(request);

    const text = await this.client.complete(prompt);

    return {
      translated: text,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      glossaryCoverage: 1,   // placeholder — the pipeline computes the real value
      missingTerms: [],       // placeholder — the pipeline computes the real value
      metadata: {
        adapter: "my-service",
        durationMs: Date.now() - start,
        retries: 0,
      },
    };
  }

  async dispose(): Promise<void> {
    this.client.close();
  }
}
```

### 2. Add the backend type to shared types

In `packages/shared/src/types.ts`, extend `AdapterBackend`:

```typescript
export type AdapterBackend = "ollama" | "mock" | "my-service";
```

And add any config fields to `AdapterConfig`:

```typescript
export interface AdapterConfig {
  backend: AdapterBackend;
  model: string;
  ollamaUrl?: string;
  myServiceApiKey?: string;   // new field
}
```

### 3. Register in the factory

```typescript
// packages/adapters/src/factory.ts
import { MyServiceAdapter } from "./my-service";

export function createAdapter(config: AdapterConfig): Adapter {
  switch (config.backend) {
    case "ollama": ...
    case "mock": ...
    case "my-service":
      if (!config.myServiceApiKey) {
        throw new TlError("ADAPTER_UNAVAILABLE", "myServiceApiKey is required", "Set MY_SERVICE_API_KEY");
      }
      return new MyServiceAdapter(config.myServiceApiKey);
  }
}
```

### 4. Make the backend selectable

Registering the backend in the factory does not make it reachable from the CLI. Frontends build the adapter config with `toAdapterConfig(coreConfig, backend?)` from `@translate-local/core/config` (`packages/core/src/config.ts`), which maps the loaded config to an `AdapterConfig` and defaults `backend` to `"ollama"`. Today the only runtime switch is in `apps/cli/src/commands/translate.ts`: the `TL_ADAPTER` environment variable picks `mock`, and any other value (with a warning for unknown ones) falls back to `ollama`. The TUI always uses the default.

To expose your backend:

- Pass it through `toAdapterConfig(config, "my-service")`, and have that function copy your new config fields (for example the API key) into the returned `AdapterConfig`.
- Extend the `TL_ADAPTER` check in `apps/cli/src/commands/translate.ts` so `TL_ADAPTER=my-service` selects it and is no longer reported as unknown.

### 5. Write a test

```typescript
// packages/adapters/src/my-service/index.test.ts
import { describe, it, expect } from "bun:test";
import { MyServiceAdapter } from "./index";

describe("MyServiceAdapter", () => {
  it("returns a translated string", async () => {
    // Use a mock client or TEST_ADAPTER=1 to hit the real service
    const adapter = new MyServiceAdapter("test-key");
    const result = await adapter.translate({
      source: "hello",
      sourceLang: "en",
      targetLang: "fr",
    });
    expect(result.translated).toBeTruthy();
    expect(result.metadata.adapter).toBe("my-service");
    await adapter.dispose();
  });
});
```

Run with: `bun run test` (or `TEST_ADAPTER=1 bun run test` for live API calls).

---

## Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Backend identifier | kebab-case | `"my-service"` |
| Class name | PascalCase + `Adapter` suffix | `MyServiceAdapter` |
| Directory | kebab-case under `packages/adapters/src/` | `my-service/` |
| `metadata.adapter` | kebab-case, matches backend identifier | `"my-service"` |

## Config Schema Fields

New fields added to `AdapterConfig` should also be reflected in the config schema at `packages/core/src/config.ts` so they can be set via `~/.config/tl/config.jsonc`.
