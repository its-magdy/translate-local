/**
 * JSON read/write with round-trip fidelity.
 *
 * Preserves: indentation (2-space, 4-space, tab), trailing newline presence,
 * and CRLF/LF line endings. Strips UTF-8 BOM on read; never emits BOM on write.
 *
 * Atomic write: serialize, write to a sibling .tmp file, fsync, rename. The
 * original is intact until the rename succeeds, so a crash mid-write leaves
 * either the old or the new file but never a partial.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { dirname, basename } from "path";
import type { JsonValue } from "./walk";

const BOM = "﻿";

export type JsonMeta = {
  indent: string;        // "  ", "    ", "\t" — what to use when serializing
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
  hadBOM: boolean;       // recorded but never re-emitted
};

export type ReadResult = {
  data: JsonValue;
  meta: JsonMeta;
};

export function detectIndent(text: string): string {
  // Find the first line that starts with whitespace (a child of an object/array).
  // Matches sequences of spaces or a tab.
  const m = text.match(/^([ \t]+)\S/m);
  if (!m) return "  "; // default 2-space when input has no indented lines (single-line JSON)
  const ws = m[1];
  if (ws.startsWith("\t")) return "\t";
  // Use the smallest run as the indent unit
  return ws;
}

export function detectEol(text: string): "\n" | "\r\n" {
  const idx = text.indexOf("\n");
  if (idx > 0 && text[idx - 1] === "\r") return "\r\n";
  return "\n";
}

export function readJson(path: string): ReadResult {
  const raw = readFileSync(path, "utf8");
  const hadBOM = raw.startsWith(BOM);
  const text = hadBOM ? raw.slice(1) : raw;
  const data = JSON.parse(text) as JsonValue;
  const meta: JsonMeta = {
    indent: detectIndent(text),
    trailingNewline: text.endsWith("\n") || text.endsWith("\r\n"),
    eol: detectEol(text),
    hadBOM,
  };
  return { data, meta };
}

export function serializeJson(data: JsonValue, meta: JsonMeta): string {
  let text = JSON.stringify(data, null, meta.indent);
  if (meta.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  if (meta.trailingNewline) text += meta.eol;
  return text;
}

/**
 * Atomic write: write `text` to `<path>.tmp-<pid>` in the same directory, then rename.
 * On rename failure (e.g. cross-device), falls back to writing in place — but the
 * tmp+rename path is the norm.
 */
export function atomicWriteFile(path: string, text: string): void {
  const dir = dirname(path);
  const tmpName = `.${basename(path)}.tmp-${process.pid}`;
  const tmpPath = `${dir}/${tmpName}`;
  try {
    writeFileSync(tmpPath, text, "utf8");
    renameSync(tmpPath, path);
  } catch (err) {
    // Best-effort cleanup of the tmp file
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function writeJson(path: string, data: JsonValue, meta: JsonMeta): void {
  const text = serializeJson(data, meta);
  atomicWriteFile(path, text);
}
