import { loadConfig, type CoreConfig } from "@translate-local/core/config";
import { formatError } from "../formatters/output";

/** Run a command action; format any error and exit 1. */
export async function runAction(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
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
