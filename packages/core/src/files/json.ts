import { readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { dirname, basename, join } from "path";
import type { JsonValue } from "./walk";

const BOM = "﻿";

export type JsonMeta = {
  indent: string;
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
  hadBOM: boolean;
};

export type ReadResult = {
  data: JsonValue;
  meta: JsonMeta;
};

export function detectIndent(text: string): string {
  const m = text.match(/^([ \t]+)\S/m);
  if (!m) return "  ";
  const ws = m[1];
  if (ws.startsWith("\t")) return "\t";
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

// Write to a sibling .tmp then rename: a crash mid-write leaves the original intact.
export function atomicWriteFile(path: string, text: string): void {
  const dir = dirname(path);
  const tmpPath = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmpPath, text, "utf8");
    renameSync(tmpPath, path);
  } catch (err) {
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
