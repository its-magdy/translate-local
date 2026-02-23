import { describe, test, expect } from "bun:test";
import { createAdapter, createMockAdapter } from "../factory";
import { MockAdapter } from "../mock";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { TranslateGemmaHFAdapter } from "../translate-gemma/huggingface";
import { TlError } from "@tl/shared/errors";
import type { AdapterConfig } from "@tl/shared/types";

describe("createAdapter", () => {
  test("creates ollama adapter", () => {
    const config: AdapterConfig = { backend: "ollama", model: "translate-gemma-12b" };
    const adapter = createAdapter(config);
    expect(adapter).toBeInstanceOf(TranslateGemmaLocalAdapter);
  });

  test("creates huggingface adapter with token", () => {
    const config: AdapterConfig = {
      backend: "huggingface",
      model: "google/translategemma-12b-it",
      hfToken: "hf_test",
    };
    const adapter = createAdapter(config);
    expect(adapter).toBeInstanceOf(TranslateGemmaHFAdapter);
  });

  test("throws TlError when huggingface token is missing", () => {
    const config: AdapterConfig = { backend: "huggingface", model: "google/translategemma-12b-it" };
    expect(() => createAdapter(config)).toThrow(TlError);
    try {
      createAdapter(config);
    } catch (err) {
      expect(err).toBeInstanceOf(TlError);
      expect((err as TlError).tag).toBe("ADAPTER_UNAVAILABLE");
    }
  });

  test("uses default model when model not specified", () => {
    const config = { backend: "ollama" } as AdapterConfig;
    const adapter = createAdapter(config);
    expect(adapter).toBeInstanceOf(TranslateGemmaLocalAdapter);
  });
});

describe("createMockAdapter", () => {
  test("returns a MockAdapter", () => {
    const adapter = createMockAdapter();
    expect(adapter).toBeInstanceOf(MockAdapter);
  });
});
