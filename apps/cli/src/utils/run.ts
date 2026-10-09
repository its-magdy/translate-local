import { loadConfig, type CoreConfig } from "@translate-local/core/config";
import { formatError, formatErrorJson } from "../formatters/output";

/**
 * Run a command action; print any error (as JSON with `json`) and set exit
 * code 1. Uses process.exitCode rather than process.exit() so piped output
 * is flushed.
 */
export async function runAction(fn: () => void | Promise<void>, { json = false } = {}): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(json ? formatErrorJson(err) : formatError(err));
    process.exitCode = 1;
  }
}

/** Open a store from the loaded config, run fn, and always close the store. */
export async function withStore<S extends { close(): void }, T>(
  open: (config: CoreConfig) => S,
  fn: (store: S) => T | Promise<T>,
): Promise<T> {
  const store = open(loadConfig());
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}
