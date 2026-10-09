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
    // Keep a code already chosen (130/143 after an interrupt).
    process.exitCode ||= 1;
  }
}

const INTERRUPT_DISPOSE_TIMEOUT_MS = 3_000;

/**
 * Until the returned stop function is called, the first SIGINT/SIGTERM
 * aborts the session's in-flight request so the action fails fast and its
 * `finally` disposes the session (unloading the model). stop() then sets
 * exit code 130/143. If that takes over 3 s the process exits anyway; a
 * second signal exits immediately.
 */
export function exitOnInterrupt(session: { abort(): void }): () => void {
  let interruptCode: number | undefined;
  let forceExit: ReturnType<typeof setTimeout> | undefined;
  const onSignal = (signal: NodeJS.Signals): void => {
    const code = signal === "SIGINT" ? 130 : 143;
    if (interruptCode !== undefined) process.exit(code);
    interruptCode = code;
    session.abort();
    forceExit = setTimeout(() => process.exit(code), INTERRUPT_DISPOSE_TIMEOUT_MS);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    clearTimeout(forceExit);
    if (interruptCode !== undefined) process.exitCode = interruptCode;
  };
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
