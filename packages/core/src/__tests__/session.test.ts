import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockAdapter } from "@translate-local/adapters/mock";
import type { TranslationRequest } from "@translate-local/shared/types";
import { IMAGE_MAX_BYTES } from "@translate-local/shared/constants";
import { configSchema, type CoreConfig } from "../config";
import { TranslationSession, readImageBase64, resolveBackend } from "../session";

describe("resolveBackend", () => {
  it("maps TL_ADAPTER to a backend, warning on unknown values", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveBackend("mock")).toBe("mock");
      expect(resolveBackend("ollama")).toBe("ollama");
      expect(resolveBackend(undefined)).toBe("ollama");
      expect(warn).not.toHaveBeenCalled();
      expect(resolveBackend("gpt")).toBe("ollama");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('unknown TL_ADAPTER "gpt"');
    } finally {
      warn.mockRestore();
    }
  });
});

describe("TranslationSession", () => {
  let dir: string;
  let config: CoreConfig;
  let session: TranslationSession;
  let requests: TranslationRequest[];
  let translateSpy: ReturnType<typeof spyOn>;
  let disposeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tl-session-"));
    config = configSchema.parse({
      glossary: { dbPath: join(dir, "glossary.db"), mode: "strict" },
      context: { dbPath: join(dir, "context.db"), maxSnippets: 2, minRelevance: 0 },
    });
    requests = [];
    const original = MockAdapter.prototype.translate;
    translateSpy = spyOn(MockAdapter.prototype, "translate").mockImplementation(function (this: MockAdapter, req: TranslationRequest) {
      requests.push(req);
      return original.call(this, req);
    });
    disposeSpy = spyOn(MockAdapter.prototype, "dispose");
    session = new TranslationSession(config, "mock");
  });

  afterEach(async () => {
    await session.dispose();
    translateSpy.mockRestore();
    disposeSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("retrieves context and applies the config's glossary settings", async () => {
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "a.md"), "the deployment pipeline promotes builds to staging");
    session.contextStore.addSource(docs);
    session.glossaryStore.add({ sourceTerm: "pipeline", targetTerm: "خط", sourceLang: "en", targetLang: "ar" });

    const result = await session.translate("the deployment pipeline", "en", "ar");

    expect(result.translated).toBe("[ar] the deployment خط");
    expect(requests).toHaveLength(1);
    expect(requests[0].contextSnippets).toEqual(["the deployment pipeline promotes builds to staging"]);
    expect(requests[0].options?.glossaryMode).toBe("strict");
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("skips context retrieval for image-only input and forwards the image", async () => {
    const retrieve = spyOn(session.contextStore, "retrieve");
    await session.translate("", "en", "ar", { imageBase64: "aGk=" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(requests[0].imageBase64).toBe("aGk=");
  });

  it("a caller signal cancels the translation", async () => {
    await expect(session.translate("hi", "en", "ar", { signal: AbortSignal.abort() })).rejects.toMatchObject({ tag: "CANCELLED" });
  });

  it("abort() cancels session translations and direct adapter requests", async () => {
    expect(session.signal.aborted).toBe(false);
    session.abort();
    expect(session.signal.aborted).toBe(true);
    await expect(session.translate("hi", "en", "ar")).rejects.toMatchObject({ tag: "CANCELLED" });
    await expect(session.adapter.translate({ source: "hi", sourceLang: "en", targetLang: "ar" })).rejects.toMatchObject({ tag: "CANCELLED" });
  });

  it("dispose() unloads once after use and is idempotent", async () => {
    await session.translate("hi", "en", "ar");
    await Promise.all([session.dispose(), session.dispose()]);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("dispose() skips the unload when nothing was translated", async () => {
    await session.dispose();
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});

describe("readImageBase64", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "tl-image-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads a valid image as base64", async () => {
    const p = join(dir, "a.png");
    writeFileSync(p, "hi");
    expect(await readImageBase64(p)).toBe("aGk=");
  });

  it("throws the typed errors", async () => {
    await expect(readImageBase64(join(dir, "a.pdf"))).rejects.toMatchObject({ tag: "IMAGE_INVALID_TYPE" });
    await expect(readImageBase64(join(dir, "missing.png"))).rejects.toMatchObject({ tag: "IMAGE_NOT_FOUND" });
    const big = join(dir, "big.png");
    writeFileSync(big, Buffer.alloc(IMAGE_MAX_BYTES + 1));
    await expect(readImageBase64(big)).rejects.toMatchObject({ tag: "IMAGE_TOO_LARGE" });
  });
});
