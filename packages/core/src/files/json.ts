import { readFileSync } from "fs";
import type { JsonValue } from "./walk";
import { atomicWriteFile } from "./atomic";

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
  duplicateKeys: DuplicateKey[];
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
  return { data, meta, duplicateKeys: findDuplicateKeys(text) };
}

export function serializeJson(data: JsonValue, meta: JsonMeta): string {
  let text = JSON.stringify(data, null, meta.indent);
  if (meta.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  if (meta.trailingNewline) text += meta.eol;
  return text;
}

export function writeJson(path: string, data: JsonValue, meta: JsonMeta): void {
  const text = serializeJson(data, meta);
  atomicWriteFile(path, text, (tmp) => { readJson(tmp); });
}

export type DuplicateKey = { path: string; line: number };

// JSON.parse keeps the last value of a repeated key and gives no hint. Scan the raw
// text (already known to be valid JSON) and report every repeated key per object, at
// any depth, with the line of the repeat. Array indices appear in paths as [n].
export function findDuplicateKeys(text: string): DuplicateKey[] {
  const out: DuplicateKey[] = [];
  let i = 0;
  let line = 1;

  const skipWs = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === "\n") line++;
      else if (c !== " " && c !== "\t" && c !== "\r") break;
      i++;
    }
  };

  const readString = (): string => {
    const start = i++; // opening quote
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };

  const readValue = (path: string) => {
    skipWs();
    const c = text[i];
    if (c === "{") {
      i++;
      const seen = new Set<string>();
      skipWs();
      if (text[i] === "}") { i++; return; }
      for (;;) {
        skipWs();
        const keyLine = line;
        const key = readString();
        const keyPath = path ? `${path}.${key}` : key;
        if (seen.has(key)) out.push({ path: keyPath, line: keyLine });
        seen.add(key);
        skipWs();
        i++; // ':'
        readValue(keyPath);
        skipWs();
        if (text[i++] === "}") return;
      }
    } else if (c === "[") {
      i++;
      skipWs();
      if (text[i] === "]") { i++; return; }
      for (let n = 0; ; n++) {
        readValue(`${path}[${n}]`);
        skipWs();
        if (text[i++] === "]") return;
      }
    } else if (c === '"') {
      readString();
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    }
  };

  readValue("");
  return out;
}
