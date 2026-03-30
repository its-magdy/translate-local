export interface TlTranslateResult {
  translated: string;
  sourceLang: string;
  targetLang: string;
  glossaryCoverage: number;
  missingTerms: string[];
  metadata: {
    adapter: string;
    durationMs: number;
    retries: number;
  };
}

export interface TlGlossaryEntry {
  id: string;
  source: string;
  target: string;
  fromLang: string;
  toLang: string;
  domain?: string;
  note?: string;
}

export interface TlError {
  tag: string;
  message: string;
  hint?: string;
}

export interface TranslateOptions {
  text: string;
  from?: string;
  to: string;
  glossaryMode?: "prefer" | "strict";
  imagePath?: string;
}

export interface GlossaryAddOptions {
  source: string;
  target: string;
  from: string;
  to: string;
  domain?: string;
  note?: string;
}
