/**
 * Gated adapter tests — require real services.
 * Run with: TEST_ADAPTER=1 bun test
 */
import { describe, test, expect } from "bun:test";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { TranslateGemmaHFAdapter } from "../translate-gemma/huggingface";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "@tl/shared/constants";

const RUN = process.env.TEST_ADAPTER === "1";

describe.if(RUN)("TranslateGemmaLocalAdapter (real Ollama)", () => {
  test("translates a simple phrase", async () => {
    const adapter = new TranslateGemmaLocalAdapter(DEFAULT_MODEL, DEFAULT_OLLAMA_URL);
    const result = await adapter.translate({
      source: "Hello",
      sourceLang: "en",
      targetLang: "ar",
    });
    expect(result.translated).toBeTruthy();
    expect(result.sourceLang).toBe("en");
    expect(result.targetLang).toBe("ar");
    await adapter.dispose();
  }, 30_000);
});

describe.if(RUN)("TranslateGemmaHFAdapter (real HuggingFace)", () => {
  test("translates a simple phrase", async () => {
    const token = process.env.HF_TOKEN ?? "";
    if (!token) throw new Error("HF_TOKEN env var required");
    const adapter = new TranslateGemmaHFAdapter("google/translategemma-4b-it", token);
    const result = await adapter.translate({
      source: "Hello",
      sourceLang: "en",
      targetLang: "ar",
    });
    expect(result.translated).toBeTruthy();
    await adapter.dispose();
  }, 30_000);
});
