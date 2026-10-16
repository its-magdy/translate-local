// Adapter types

export interface TranslationRequest {
  source: string;
  sourceLang: string;
  targetLang: string;
  imageBase64?: string;   // base64-encoded image for vision translation
  glossaryHits?: GlossaryHit[];
  contextSnippets?: string[];
  /** Glossary retries (both modes): terms the previous attempt left out, rendered as instructions (never appended to `source`). */
  glossaryReminder?: { source: string; target: string }[];
  /**
   * Agreement repair (#115) instead of a translation: `source` is a finished
   * `targetLang` translation containing these glossary target terms verbatim.
   * Return it with only the grammar around them corrected (gender, case,
   * number, articles, adjective endings), the terms and everything else
   * unchanged. `sourceLang` is still the original text's language.
   */
  repairTerms?: string[];
  onChunk?: (chunk: string) => void;
  /** Caller cancellation: adapters stop the request and throw `cancelledError()` (tag `CANCELLED`). */
  signal?: AbortSignal;
  options?: {
    glossaryMode?: "strict" | "prefer";
  };
}

export interface TranslationResult {
  translated: string;
  sourceLang: string;
  targetLang: string;
  glossaryCoverage: number; // 0-1
  missingTerms: string[];
  metadata: {
    adapter: string;
    durationMs: number;
    retries: number;
    /** Set by the pipeline when its agreement repair pass changed the text. */
    repaired?: boolean;
  };
}

export interface Adapter {
  translate(request: TranslationRequest): Promise<TranslationResult>;
  dispose(): Promise<void>;
}

// Glossary types

export interface GlossaryEntry {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  sourceLang: string;
  targetLang: string;
  domain?: string;
  note?: string;
  /**
   * Other target forms that also count as the term (de `Bereitstellung` or the
   * split `stellen … bereit` for `bereitstellen`). The prompt still names
   * `targetTerm`; see `termForms()` in `@translate-local/shared/utils/text`.
   */
  forms?: string[];
}

export interface GlossaryHit {
  entry: GlossaryEntry;
  startIndex: number;
  endIndex: number;
}

// Context types

export interface ContextSource {
  id: string;
  path: string;
  addedAt: string;
  indexedAt?: string;
  fileCount: number;
}

export interface ContextSnippet {
  sourceId: string;
  filePath: string;
  content: string;
  score: number;
}

// Config types

export type AdapterBackend = "ollama" | "mock";

export interface AdapterConfig {
  backend: AdapterBackend;
  model: string;
  ollamaUrl?: string;
}
