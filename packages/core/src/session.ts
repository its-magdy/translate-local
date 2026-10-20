import type { Adapter, AdapterBackend, GlossaryHit, TranslationResult } from "@translate-local/shared/types";
import { TlError } from "@translate-local/shared/errors";
import { IMAGE_EXT_RE, IMAGE_MAX_BYTES } from "@translate-local/shared/constants";
import { createAdapter } from "@translate-local/adapters/factory";
import { toAdapterConfig, type CoreConfig } from "./config";
import { GlossaryStore } from "./glossary";
import { ContextStore } from "./context";
import { runPipeline } from "./pipeline";
import { pipelineTranslator, type FileTranslator } from "./files";
import { maskText, sentinelHits, sentinelIndices, unmask, unmaskStream } from "./files/placeholders";

// Attempts for a text whose answer loses, adds or translates a placeholder.
// Fewer than file mode's 10: someone is waiting, and sees the result.
const TEXT_PLACEHOLDER_ATTEMPTS = 3;

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
  /** Every request also carries the session's abort signal. */
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

  /**
   * Context retrieval + runPipeline with the config's glossary and context
   * settings. Placeholders in the text (`{name}`, `{{count}}`, `%s`) go to the
   * model as sentinels, as in file mode, and an answer that loses one is retried.
   */
  async translate(text: string, sourceLang: string, targetLang: string, options: SessionTranslateOptions = {}): Promise<TranslationResult> {
    const { glossaryMode, maxRetries, maxSnippets, minRelevance } = this.settings(options.glossaryMode);
    const contextSnippets = text
      ? this.contextStore.retrieve(text, maxSnippets, minRelevance).map((s) => s.content)
      : [];
    const run = (source: string, extraGlossaryHits: GlossaryHit[], onChunk?: (chunk: string) => void) =>
      runPipeline(source, sourceLang, targetLang, this.adapter, this.glossaryStore, {
        glossaryMode,
        maxRetries,
        contextSnippets,
        imageBase64: options.imageBase64,
        onChunk,
        extraGlossaryHits,
        signal: this.signalWith(options.signal),
      });
    const { masked, placeholders } = options.imageBase64 ? { masked: text, placeholders: [] } : maskText(text);
    if (placeholders.length === 0) return run(text, [], options.onChunk);

    const hits = sentinelHits(masked, placeholders.map((ph) => ph.index), sourceLang, targetLang);
    const expected = placeholders.map((ph) => ph.index).join(" ");
    let result!: TranslationResult;
    for (let attempt = 0; attempt < TEXT_PLACEHOLDER_ATTEMPTS; attempt++) {
      // Only the first attempt streams, as only the pipeline's first call does.
      const onChunk = attempt === 0 && options.onChunk ? unmaskStream(options.onChunk, placeholders) : undefined;
      result = await run(masked, hits, onChunk);
      const kept = sentinelIndices(result.translated).sort((a, b) => a - b).join(" ") === expected;
      result = { ...result, translated: unmask(result.translated, placeholders) };
      if (kept) return result;
    }
    return { ...result, metadata: { ...result.metadata, placeholderMismatch: true } };
  }

  /** What translateFile translates with: the same settings as translate(), per leaf. */
  fileTranslator(options: { glossaryMode?: "strict" | "prefer" } = {}): FileTranslator {
    return pipelineTranslator(this.adapter, this.glossaryStore, this.contextStore, this.settings(options.glossaryMode));
  }

  /** Cancel every in-flight and future request of this session. */
  abort(): void {
    this.controller.abort();
  }

  /** Aborted by abort(); pass it to translateFile so it stops between leaves. */
  get signal(): AbortSignal {
    return this.controller.signal;
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

  private settings(glossaryMode?: "strict" | "prefer") {
    const { context, glossary } = this.config;
    return {
      glossaryMode: glossaryMode ?? glossary.mode,
      maxRetries: glossary.maxRetries,
      maxSnippets: context.maxSnippets,
      minRelevance: context.minRelevance,
    };
  }

  private signalWith(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal;
  }
}
