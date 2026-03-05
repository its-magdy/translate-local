// Adapter types

export interface TranslationRequest {
  source: string;
  sourceLang: string;
  targetLang: string;
  imageBase64?: string;   // base64-encoded image for vision translation
  glossaryHits?: GlossaryHit[];
  contextSnippets?: string[];
  onChunk?: (chunk: string) => void;
  options?: {
    formality?: "formal" | "informal";
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

export type AdapterBackend = "ollama";

export interface AdapterConfig {
  backend: AdapterBackend;
  model: string;
  ollamaUrl?: string;
}

export interface TlConfig {
  adapter: AdapterConfig;
  glossaryDb?: string;
  contextDb?: string;
}
