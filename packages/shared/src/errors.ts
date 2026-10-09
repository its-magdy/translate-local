export type ErrorTag =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "ADAPTER_UNAVAILABLE"
  | "TRANSLATION_FAILED"
  | "GLOSSARY_STRICT_MISS"
  | "GLOSSARY_DB_ERROR"
  | "CONTEXT_DB_ERROR"
  | "INVALID_LANGUAGE"
  | "INVALID_INPUT"
  | "IMAGE_NOT_FOUND"
  | "IMAGE_READ_FAILED"
  | "IMAGE_INVALID_TYPE"
  | "IMAGE_TOO_LARGE"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "FILE_PARSE_FAILED"
  | "FILE_WRITE_FAILED"
  | "FILE_INVALID_FORMAT"
  | "PLACEHOLDER_MISMATCH"
  | "PRUNE_REFUSED"
  | "SAME_LOCALE"
  | "CANCELLED";

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

/** A translation stopped by the caller's AbortSignal (as opposed to a timeout). */
export function cancelledError(cause?: unknown): TlError {
  return new TlError("CANCELLED", "Translation cancelled", "The request was aborted before it finished; run it again to retry.", cause);
}
