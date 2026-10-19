import { describe, it, expect } from "bun:test";
import type { FileTranslateSummary } from "@translate-local/core/files";
import { formatFileSummary } from "../formatters/output";

const base: FileTranslateSummary = {
  contentFormat: "vanilla",
  totalLeaves: 3,
  translated: 1,
  skipped: { count: 1, reasons: { url: 1 } },
  failed: [{ path: "a.b", pointer: "/a/b", tag: "PLACEHOLDER_MISMATCH", reason: "lost {name}" }],
  changed: ["/c"],
  pruned: ["/old"],
  warnings: ["careful"],
  pluralFallbacks: 0,
  aborted: false,
  outPath: "/tmp/ar.json",
  rootLocaleKey: { from: "en", to: "ar" },
};

describe("formatFileSummary", () => {
  it("prints counts on stdout, then failures and warnings on stderr", () => {
    expect(formatFileSummary(base, "/tmp/en.json", { dryRun: false, prune: true })).toEqual({
      stdout: [
        "Wrote /tmp/ar.json",
        "Format: vanilla",
        "Root locale key: en -> ar",
        "Translated: 1 / 3",
        "Source changed: 1",
        "Pruned: 1",
        "Skipped: 1 (url=1)",
        "Failed: 1 (source value used as fallback — search the output for un-translated source text)",
      ],
      stderr: ["  a.b: lost {name}", "Warning: careful"],
    });
  });

  it("lists what a dry run would do, and prune lines only with --prune", () => {
    expect(formatFileSummary(base, "/tmp/en.json", { dryRun: true, prune: false })).toEqual({
      stdout: [
        "[dry-run] Source: /tmp/en.json",
        "[dry-run] Target: /tmp/ar.json (NOT written)",
        "[dry-run] Format: vanilla",
        "[dry-run] Root locale key: en -> ar",
        "[dry-run] Would translate: 1",
        "[dry-run] Would skip: 1",
        "[dry-run] Source changed: 1",
        "  /c",
      ],
      stderr: ["Warning: careful"],
    });
  });

  it("omits empty sections", () => {
    const clean = { ...base, skipped: { count: 0, reasons: {} }, failed: [], changed: [], warnings: [], rootLocaleKey: undefined };
    expect(formatFileSummary(clean, "/tmp/en.json", { dryRun: false, prune: false })).toEqual({
      stdout: ["Wrote /tmp/ar.json", "Format: vanilla", "Translated: 1 / 3"],
      stderr: [],
    });
  });
});
