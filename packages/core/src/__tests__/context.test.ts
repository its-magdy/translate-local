import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ContextStore } from "../context";

const IS_INTEGRATION = !!process.env.TEST_INTEGRATION;

const testFn = IS_INTEGRATION ? test : test.skip;

describe("ContextStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: ContextStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tl-ctx-test-"));
    dbPath = join(tmpDir, "context.db");

    // Create 3 md files with distinct vocabulary
    writeFileSync(join(tmpDir, "machine.md"), "machine learning neural network deep learning gradient descent backpropagation training data");
    writeFileSync(join(tmpDir, "cooking.md"), "cooking recipe ingredients flour butter sugar bake oven temperature");
    writeFileSync(join(tmpDir, "medical.md"), "diagnosis treatment medication prescription dosage clinical patient physician");
  });

  afterEach(() => {
    store?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  testFn("addSource returns correct fileCount and sets indexedAt", () => {
    store = new ContextStore(dbPath);
    const source = store.addSource(tmpDir);
    expect(source.fileCount).toBe(3);
    expect(source.indexedAt).toBeDefined();
    expect(source.path).toBe(tmpDir);
    expect(source.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  testFn("listSources returns the added source", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const sources = store.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe(tmpDir);
  });

  testFn("retrieve returns machine.md as top result for machine learning query", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const snippets = store.retrieve("machine learning", 5);
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0].filePath).toContain("machine.md");
  });

  testFn("retrieve returns empty array for unknown query", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);
    const snippets = store.retrieve("zzzzz");
    expect(snippets).toEqual([]);
  });

  testFn("removeSource empties list and retrieve returns empty", () => {
    store = new ContextStore(dbPath);
    const source = store.addSource(tmpDir);
    store.removeSource(source.id);
    expect(store.listSources()).toHaveLength(0);
    expect(store.retrieve("machine learning")).toEqual([]);
  });

  testFn("reindex updates fileCount after new file is added", () => {
    store = new ContextStore(dbPath);
    store.addSource(tmpDir);

    // Add a new file
    writeFileSync(join(tmpDir, "legal.md"), "contract statute jurisdiction litigation plaintiff defendant court");
    store.reindex();

    const sources = store.listSources();
    expect(sources[0].fileCount).toBe(4);
    const snippets = store.retrieve("litigation court");
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0].filePath).toContain("legal.md");
  });

  testFn("addSource with invalid path throws CONTEXT_DB_ERROR", () => {
    store = new ContextStore(dbPath);
    expect(() => store.addSource("/nonexistent/path/that/does/not/exist")).toThrow();
    try {
      store.addSource("/nonexistent/path/that/does/not/exist");
    } catch (err: any) {
      expect(err.tag).toBe("CONTEXT_DB_ERROR");
    }
  });
});
