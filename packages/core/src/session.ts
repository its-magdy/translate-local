import type { Adapter, AdapterBackend, TranslationResult } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { IMAGE_EXT_RE, IMAGE_MAX_BYTES } from "@translate-local/shared/constants";
import { createAdapter } from "@translate-local/adapters/factory";
import { toAdapterConfig, type CoreConfig } from "./config";
import { GlossaryStore } from "./glossary";
import { ContextStore } from "./context";
import { runPipeline } from "./pipeline";

/** Adapter backend from TL_ADAPTER: "mock", else "ollama" (with a warning for unknown values). */
export function resolveBackend(value = process.env.TL_ADAPTER): AdapterBackend {
  if (value === "mock") return "mock";
  if (value && value !== "ollama") console.warn(`Warning: unknown TL_ADAPTER "${value}", falling back to "ollama"`);
  return "ollama";
}

/** Validate an image path (extension, existence, ≤ 10 MB) and read it as base64. */
export async function readImageBase64(path: string): Promise<string> {
  if (!IMAGE_EXT_RE.test(path)) {
    throw new TlError("IMAGE_INVALID_TYPE", `Unsupported image type: ${path}`, "Use a .png, .jpg, .jpeg, .webp, .gif, or .bmp file.");
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new TlError("IMAGE_NOT_FOUND", `Image not found: ${path}`, "Check the file path and try again.");
  }
  if (file.size > IMAGE_MAX_BYTES) {
    throw new TlError("IMAGE_TOO_LARGE", `Image exceeds 10 MB: ${path}`, "Use a smaller image file.");
  }
  try {
    return Buffer.from(await file.arrayBuffer()).toString("base64");
  } catch (err) {
    throw new TlError("IMAGE_READ_FAILED", `Failed to read image: ${path}`, "Ensure the file is readable.", err);
  }
}

export interface SessionTranslateOptions {
  imageBase64?: string;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
  /** Defaults to config `glossary.mode`. */
  glossaryMode?: "strict" | "prefer";
}

/**
 * What a frontend needs to translate: the adapter (backend from TL_ADAPTER),
 * the glossary and context stores, and one abort switch for all of it.
 */
export class TranslationSession {
  readonly glossaryStore: GlossaryStore;
  readonly contextStore: ContextStore;
  /**
   * For callers that drive the pipeline themselves (file mode). Every request
   * also carries the session's abort signal.
   */
  readonly adapter: Adapter;
  private readonly inner: Adapter;
  private readonly controller = new AbortController();
  private used = false;
  private disposing?: Promise<void>;

  constructor(readonly config: CoreConfig, backend: AdapterBackend = resolveBackend()) {
    this.inner = createAdapter(toAdapterConfig(config, backend));
    this.adapter = {
      translate: (request) => {
        this.used = true;
        return this.inner.translate({ ...request, signal: this.signalWith(request.signal) });
      },
      dispose: () => this.inner.dispose(),
    };
    this.glossaryStore = new GlossaryStore(config.glossary.dbPath);
    try {
      this.contextStore = new ContextStore(config.context.dbPath);
    } catch (err) {
      this.glossaryStore.close();
      throw err;
    }
  }

  /** Context retrieval + runPipeline with the config's glossary and context settings. */
  translate(text: string, sourceLang: string, targetLang: string, options: SessionTranslateOptions = {}): Promise<TranslationResult> {
    const { context, glossary } = this.config;
    const contextSnippets = text
      ? this.contextStore.retrieve(text, context.maxSnippets, context.minRelevance).map((s) => s.content)
      : [];
    return runPipeline(text, sourceLang, targetLang, this.adapter, this.glossaryStore, {
      glossaryMode: options.glossaryMode ?? glossary.mode,
      maxRetries: glossary.maxRetries,
      contextSnippets,
      imageBase64: options.imageBase64,
      onChunk: options.onChunk,
      signal: this.signalWith(options.signal),
    });
  }

  /** Cancel every in-flight and future request of this session. */
  abort(): void {
    this.controller.abort();
  }

  /**
   * Close the stores and unload the model. Idempotent. The unload is skipped
   * when the session never sent a request (nothing for it to unload).
   */
  dispose(): Promise<void> {
    this.disposing ??= (async () => {
      try { this.glossaryStore.close(); } catch {}
      try { this.contextStore.close(); } catch {}
      if (this.used) await this.inner.dispose();
    })();
    return this.disposing;
  }

  private signalWith(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal;
  }
}
