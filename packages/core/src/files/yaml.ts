/**
 * YAML round-trip — Phase B implementation.
 *
 * Stubbed in Phase A so the orchestrator can be written and tested against JSON
 * without forward refs. The actual `yaml` package integration lands in Phase B.
 */

import { TlError } from "@translate-local/shared/errors";
import type { JsonValue } from "./walk";

// Real shape lands in Phase B; placeholder type for now.
export type YamlMeta = {
  indent: number;
  trailingNewline: boolean;
  eol: "\n" | "\r\n";
};

export type YamlReadResult = {
  data: JsonValue;
  doc: unknown; // yaml.Document — typed in Phase B
  meta: YamlMeta;
};

export function readYaml(_path: string): YamlReadResult {
  throw new TlError(
    "FILE_INVALID_TYPE",
    "YAML file translation is not implemented yet",
    "YAML support is planned for Phase B. Use JSON for now.",
  );
}

export function writeYaml(_path: string, _doc: unknown, _meta: YamlMeta, _data: JsonValue): void {
  throw new TlError(
    "FILE_INVALID_TYPE",
    "YAML file translation is not implemented yet",
    "YAML support is planned for Phase B.",
  );
}
