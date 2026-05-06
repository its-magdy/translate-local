import { describe, test, expect } from "bun:test";
import { TlError, type ErrorTag } from "../errors";

describe("TlError", () => {
  test("captures tag, message, and hint", () => {
    const e = new TlError("FILE_NOT_FOUND", "missing", "check the path");
    expect(e.tag).toBe("FILE_NOT_FOUND");
    expect(e.message).toBe("missing");
    expect(e.hint).toBe("check the path");
    expect(e.name).toBe("TlError");
    expect(e instanceof Error).toBe(true);
  });

  test("preserves cause when provided", () => {
    const cause = new Error("underlying");
    const e = new TlError("FILE_PARSE_FAILED", "bad json", "validate first", cause);
    expect(e.cause).toBe(cause);
  });

  test("file-translate tags are present in the union", () => {
    const tags: ErrorTag[] = [
      "FILE_NOT_FOUND",
      "FILE_TOO_LARGE",
      "FILE_INVALID_TYPE",
      "FILE_PARSE_FAILED",
      "FILE_WRITE_FAILED",
      "FILE_EMPTY",
      "FILE_INVALID_FORMAT",
      "PLACEHOLDER_MISMATCH",
      "SAME_LOCALE",
    ];
    for (const t of tags) {
      const e = new TlError(t, "m", "h");
      expect(e.tag).toBe(t);
    }
  });
});
