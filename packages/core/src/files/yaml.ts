// Mutate Scalar.value directly when updating a leaf — setIn() would reset the
// scalar style (block `|`, folded `>`, quoting). Refuses files with anchors/aliases,
// custom tags, multi-document streams, or YAML 1.1 directives.

import { readFileSync } from "fs";
import { Document, parseDocument, isMap, isSeq, isScalar, isAlias, Scalar, YAMLMap, YAMLSeq } from "yaml";
import { TlError } from "@translate-local/shared/errors";
import type { JsonValue } from "./walk";
import { atomicWriteFile } from "./json";

export type YamlMeta = {
  indent: number;
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
};

export type YamlReadResult = {
  data: JsonValue;
  doc: Document.Parsed;
  meta: YamlMeta;
};

function detectIndent(text: string): number {
  const m = text.match(/^( +)\S/m);
  if (!m) return 2;
  return m[1].length;
}

function detectEol(text: string): "\n" | "\r\n" {
  const idx = text.indexOf("\n");
  if (idx > 0 && text[idx - 1] === "\r") return "\r\n";
  return "\n";
}

function refuseIfDocumentHas(doc: Document.Parsed, src: string): void {
  const directiveMatch = src.match(/^%YAML\s+(\d+\.\d+)/m);
  if (directiveMatch && directiveMatch[1] === "1.1") {
    throw new TlError(
      "FILE_INVALID_FORMAT",
      "YAML 1.1 directive detected",
      "Re-save as YAML 1.2 (most modern editors default to this). YAML 1.1 has implicit-typing edge cases (Norway problem) we don't handle safely.",
    );
  }

  const stack: unknown[] = [doc.contents];
  while (stack.length > 0) {
    const node = stack.pop();
    if (isAlias(node)) {
      throw new TlError(
        "FILE_INVALID_FORMAT",
        "YAML aliases are not supported",
        "Inline the alias before translating, or use --format raw-json (which loses YAML round-trip).",
      );
    }
    if (isScalar(node)) {
      if ((node as Scalar).anchor) {
        throw new TlError(
          "FILE_INVALID_FORMAT",
          "YAML anchors are not supported",
          "Inline the anchored value, or use --format raw-json.",
        );
      }
      const tag = (node as Scalar).tag;
      if (
        tag &&
        typeof tag === "string" &&
        tag !== "tag:yaml.org,2002:str" &&
        tag !== "tag:yaml.org,2002:null" &&
        !tag.startsWith("?") &&
        (tag.includes("binary") || tag.includes("timestamp"))
      ) {
        throw new TlError(
          "FILE_INVALID_FORMAT",
          `YAML scalar with explicit tag ${tag}`,
          "Custom tags on scalars are not supported.",
        );
      }
      continue;
    }
    if (isMap(node)) {
      const m = node as YAMLMap;
      if (m.anchor) {
        throw new TlError("FILE_INVALID_FORMAT", "YAML anchors are not supported", "Inline the anchored block.");
      }
      for (const item of m.items) {
        stack.push(item.key);
        stack.push(item.value);
      }
    } else if (isSeq(node)) {
      const s = node as YAMLSeq;
      if (s.anchor) {
        throw new TlError("FILE_INVALID_FORMAT", "YAML anchors are not supported", "Inline the anchored block.");
      }
      for (const item of s.items) stack.push(item);
    }
  }
}

export function readYaml(path: string): YamlReadResult {
  const raw = readFileSync(path, "utf8");

  if (/^---\s*$/m.test(raw) && /^---/m.test(raw.split(/^---/m).slice(1).join(""))) {
    throw new TlError(
      "FILE_INVALID_FORMAT",
      "Multi-document YAML streams are not supported",
      "Split the file into separate single-document files.",
    );
  }

  let doc: Document.Parsed;
  try {
    doc = parseDocument(raw, { version: "1.2", prettyErrors: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TlError("FILE_PARSE_FAILED", `YAML parse failed: ${msg}`, "Validate with `yq .` first.", err);
  }

  if (doc.errors.length > 0) {
    const messages = doc.errors.map((e) => e.message).join("; ");
    throw new TlError("FILE_PARSE_FAILED", `YAML parse errors: ${messages}`, "Validate with `yq .` first.");
  }

  refuseIfDocumentHas(doc, raw);

  const data = doc.toJS({ maxAliasCount: 0 }) as JsonValue;
  const meta: YamlMeta = {
    indent: detectIndent(raw),
    trailingNewline: raw.endsWith("\n") || raw.endsWith("\r\n"),
    eol: detectEol(raw),
  };
  return { data, doc, meta };
}

function applyToDoc(doc: Document.Parsed, data: JsonValue): void {
  // A comments-only or empty source parses to contents === null; apply() would
  // no-op and the write would silently drop every key in `data`.
  if (doc.contents === null || doc.contents === undefined) {
    if (data !== null) doc.contents = doc.createNode(data) as Document.Parsed["contents"];
    return;
  }
  apply(doc, doc.contents, data);
}

// Whether the doc node can absorb `value` in place. Non-string primitives return
// true: they never come from translation, so the source node is left untouched.
function shapeMatches(node: unknown, value: JsonValue): boolean {
  if (typeof value === "string") return isScalar(node);
  if (Array.isArray(value)) return isSeq(node);
  if (typeof value === "object" && value !== null) return isMap(node);
  return true;
}

function apply(doc: Document.Parsed, node: unknown, value: JsonValue): void {
  if (isMap(node)) {
    const m = node as YAMLMap;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const v = value as { [k: string]: JsonValue };
    const docKeys = new Set<string>();
    for (const item of m.items) {
      const k = isScalar(item.key) ? String((item.key as Scalar).value) : String(item.key);
      docKeys.add(k);
      if (!(k in v)) continue;
      const child = v[k];
      if (typeof child === "string" && isScalar(item.value)) {
        (item.value as Scalar).value = child;
      } else if (shapeMatches(item.value, child)) {
        if (item.value !== undefined && item.value !== null) apply(doc, item.value, child);
      } else {
        // Shape mismatch (e.g. source scalar vs target map, or an empty `key:`):
        // replace wholesale, otherwise the target's structure is silently dropped.
        item.value = doc.createNode(child);
      }
    }
    // The doc being mutated is the SOURCE document; data may carry keys that only
    // exist in the existing target file. Append them or they are silently dropped.
    for (const [k, child] of Object.entries(v)) {
      if (!docKeys.has(k)) m.items.push(doc.createPair(k, child));
    }
    return;
  }
  if (isSeq(node)) {
    const s = node as YAMLSeq;
    if (!Array.isArray(value)) return;
    for (let i = 0; i < s.items.length && i < value.length; i++) {
      const child = value[i];
      const item = s.items[i];
      if (typeof child === "string" && isScalar(item)) {
        (item as Scalar).value = child;
      } else if (shapeMatches(item, child)) {
        if (item !== undefined && item !== null) apply(doc, item, child);
      } else {
        s.items[i] = doc.createNode(child);
      }
    }
    for (let i = s.items.length; i < value.length; i++) {
      s.items.push(doc.createNode(value[i]));
    }
    return;
  }
  if (isScalar(node) && typeof value === "string") {
    (node as Scalar).value = value;
  }
}

export function writeYaml(path: string, doc: Document.Parsed, meta: YamlMeta, data: JsonValue): void {
  applyToDoc(doc, data);
  let text = doc.toString({ indent: meta.indent, lineWidth: 0 });
  if (meta.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  if (!meta.trailingNewline) {
    if (text.endsWith("\r\n")) text = text.slice(0, -2);
    else if (text.endsWith("\n")) text = text.slice(0, -1);
  }
  atomicWriteFile(path, text, (tmp) => { readYaml(tmp); });
}
