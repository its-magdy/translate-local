import { describe, test, expect } from "bun:test";
import { createAdapter, createMockAdapter } from "../factory";
import { MockAdapter } from "../mock";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import type { AdapterConfig } from "@translate-local/shared/types";

describe("createAdapter", () => {
  test("creates ollama adapter", () => {
    const config: AdapterConfig = { backend: "ollama", model: "translate-gemma-12b" };
    const adapter = createAdapter(config);
    expect(adapter).toBeInstanceOf(TranslateGemmaLocalAdapter);
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
