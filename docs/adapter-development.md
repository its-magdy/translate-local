# Adapter Development

This guide explains how to implement a custom adapter for `tl`.

## The Adapter Interface

All adapters implement the `Adapter` interface from `@tl/shared/types`:

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
  glossaryHits?: GlossaryHit[];      // Matched glossary entries
  contextSnippets?: string[];        // Relevant context passages
  options?: {
    formality?: "formal" | "informal";
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

### `dispose()`

Called when the adapter is no longer needed. Use it to release resources (close connections, unload models from VRAM). If your adapter has no resources to clean up, return `Promise.resolve()`.

---

## Prompt Utilities

`packages/adapters/src/base.ts` exports two prompt-building helpers:

```typescript
// For TranslateGemma models (structured format with XML tags)
buildStructuredPrompt(request: TranslationRequest): string

// For generic LLMs (natural language instructions)
buildNaturalPrompt(request: TranslationRequest): string
```

`buildNaturalPrompt` injects glossary terms as bullet points and appends context snippets. Use it as a starting point for non-TranslateGemma adapters.

---

## The `createAdapter()` Factory

`packages/adapters/src/factory.ts` maps `AdapterConfig.backend` to a concrete adapter:

```typescript
export function createAdapter(config: AdapterConfig): Adapter {
  switch (config.backend) {
    case "ollama":
      return new TranslateGemmaLocalAdapter(config.model, config.ollamaUrl);
    case "huggingface":
      return new TranslateGemmaHFAdapter(config.model, config.hfToken);
    default:
      throw new TlError("CONFIG_INVALID", `Unknown backend: ${config.backend}`, ...);
  }
}
```

To add a new backend type, add a case to this switch.

---

## Step-by-Step: Creating a New Adapter

### 1. Create the adapter file

```typescript
// packages/adapters/src/my-service/index.ts
import type { Adapter, TranslationRequest, TranslationResult } from "@tl/shared/types";
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
      glossaryCoverage: 0,   // pipeline computes this
      missingTerms: [],       // pipeline computes this
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
export type AdapterBackend = "ollama" | "huggingface" | "my-service";
```

And add any config fields to `AdapterConfig`:

```typescript
export interface AdapterConfig {
  backend: AdapterBackend;
  model: string;
  ollamaUrl?: string;
  hfToken?: string;
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
    case "huggingface": ...
    case "my-service":
      if (!config.myServiceApiKey) {
        throw new TlError("ADAPTER_UNAVAILABLE", "myServiceApiKey is required", "Set MY_SERVICE_API_KEY");
      }
      return new MyServiceAdapter(config.myServiceApiKey);
  }
}
```

### 4. Write a test

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
