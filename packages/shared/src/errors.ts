export type ErrorTag =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "ADAPTER_UNAVAILABLE"
  | "TRANSLATION_FAILED"
  | "GLOSSARY_STRICT_MISS"
  | "GLOSSARY_DB_ERROR"
  | "CONTEXT_DB_ERROR"
  | "INVALID_LANGUAGE"
  | "INVALID_INPUT";

export class TlError extends Error {
  readonly tag: ErrorTag;
  readonly hint: string;

  constructor(tag: ErrorTag, message: string, hint: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TlError";
    this.tag = tag;
    this.hint = hint;
  }
}
