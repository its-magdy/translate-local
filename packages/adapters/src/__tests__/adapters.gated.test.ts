/**
 * Gated adapter tests — require real services.
 * Run with: TEST_ADAPTER=1 bun test
 */
import { describe, test, expect } from "bun:test";
import { TranslateGemmaLocalAdapter } from "../translate-gemma/local";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from "@translate-local/shared/constants";

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
