// Mutate Scalar.value directly when updating a leaf — setIn() would reset the
// scalar style (block `|`, folded `>`, quoting). Refuses files with anchors/aliases,
// custom tags, multi-document streams, or YAML 1.1 directives.

import { Document, parseDocument, isMap, isSeq, isScalar, isAlias, Scalar, YAMLMap, YAMLSeq } from "yaml";
import { TlError } from "@translate-local/shared/errors";
import type { JsonValue } from "./walk";
import { detectEol } from "./json";
import { sourceCatalog, type CatalogFormat } from "./catalog";
import type { RootLocaleRename } from "./locale-root";
import { regenerateYamlPlurals } from "./i18next";

type YamlMeta = {
  indent: number;
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
};

function detectIndent(text: string): number {
  const m = text.match(/^( +)\S/m);
  if (!m) return 2;
  return m[1].length;
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
      if (tag && !tag.startsWith("?") && (tag.includes("binary") || tag.includes("timestamp"))) {
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

function parse(raw: string): { data: JsonValue; doc: Document.Parsed; meta: YamlMeta } {

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
  // A comments-only or empty source parses to contents === null: there is no
  // node to write onto, so the data becomes the document's contents.
  if (doc.contents === null || doc.contents === undefined) {
    if (data !== null) doc.contents = doc.createNode(data) as Document.Parsed["contents"];
    return;
  }
  doc.contents = applyValue(doc, doc.contents, data) as Document.Parsed["contents"];
}

// A block scalar's chomping indicator is derived from its value's trailing
// newlines: `|` keeps one, `|-` strips them, `|+` keeps all. Translated text
// comes back with none, which would silently rewrite `|` as `|-`, so carry the
// original trailing run over onto the new value.
function setScalarValue(node: Scalar, next: string): void {
  const prev = node.value;
  const isBlock = node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED;
  if (isBlock && typeof prev === "string") {
    node.value = next.replace(/\n*$/, "") + (prev.match(/\n*$/)?.[0] ?? "");
    return;
  }
  node.value = next;
}

/**
 * Writes `value` onto the source document's `node` and returns the node to put
 * in its place. The written data is exactly `value`, as in JSON: the target's
 * values win, and keys or items the data lacks are dropped (#160). Where the
 * shapes agree the source node is reused, keeping its comments and style;
 * otherwise (a source scalar vs a target map, a number vs a string) the value
 * gets a new node.
 */
function applyValue(doc: Document.Parsed, node: unknown, value: JsonValue): unknown {
  if (typeof value === "string") {
    if (!isScalar(node)) return doc.createNode(value);
    setScalarValue(node as Scalar, value);
    return node;
  }
  if (value === null || typeof value !== "object") {
    if (!isScalar(node)) return doc.createNode(value);
    const scalar = node as Scalar;
    // An equal value keeps its written form (`0x10`, `~`).
    if (scalar.value === value) return node;
    if (value === null || scalar.value === null || typeof scalar.value !== typeof value) return doc.createNode(value);
    scalar.value = value;
    return node;
  }
  if (Array.isArray(value)) {
    if (!isSeq(node)) return doc.createNode(value);
    const s = node as YAMLSeq;
    s.items = value.map((child, i) => (i < s.items.length ? applyValue(doc, s.items[i], child) : doc.createNode(child)));
    return node;
  }
  if (!isMap(node)) return doc.createNode(value);
  const m = node as YAMLMap;
  const docKeys = new Set<string>();
  const items = [];
  for (const item of m.items) {
    const k = keyString(item.key);
    docKeys.add(k);
    if (!(k in value)) continue;
    item.value = applyValue(doc, item.value, value[k]);
    items.push(item);
  }
  // Keys only the target has (the document is the source's) go at the end.
  for (const [k, child] of Object.entries(value)) {
    if (!docKeys.has(k)) items.push(doc.createPair(k, child));
  }
  m.items = items;
  return node;
}

function keyString(key: unknown): string {
  return isScalar(key) ? String((key as Scalar).value) : String(key);
}

/** Rename the root pair's key in place so its comments and styles survive. */
function renameRootKey(doc: Document.Parsed, rename: RootLocaleRename): void {
  if (!isMap(doc.contents)) return;
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && String((pair.key as Scalar).value) === rename.from) {
      (pair.key as Scalar).value = rename.to;
      return;
    }
  }
}

function serialize(doc: Document.Parsed, meta: YamlMeta, data: JsonValue): string {
  applyToDoc(doc, data);
  let text = doc.toString({ indent: meta.indent, lineWidth: 0 });
  if (meta.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  if (!meta.trailingNewline) {
    if (text.endsWith("\r\n")) text = text.slice(0, -2);
    else if (text.endsWith("\n")) text = text.slice(0, -1);
  }
  return text;
}

// The output is the target data written onto the source document, so the
// document is renamed and its plural groups regenerated like the data, keeping
// generated keys where the group was.
export const yamlFormat: CatalogFormat = {
  open(raw) {
    const { data, doc, meta } = parse(raw);
    return sourceCatalog(data, [], {
      retarget(r) {
        if (r.localeRoot) renameRootKey(doc, r.localeRoot.rename);
        if (r.plurals) regenerateYamlPlurals(doc, r.plurals.sourceLang, r.plurals.targetLang);
      },
      serialize: (output) => serialize(doc, meta, output),
    });
  },
  read: (raw) => parse(raw).data,
};
