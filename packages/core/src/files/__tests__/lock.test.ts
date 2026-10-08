import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, realpathSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TlError } from "@translate-local/shared/errors";
import { lockPathFor, hashSource, lockKey, readLock, writeLock } from "../lock";

describe("lock helpers", () => {
  test("hashSource is the first 16 hex chars (64 bits) of sha256 of the UTF-8 value", () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e… — well-known test vector.
    expect(hashSource("hello")).toBe("2cf24dba5fb0a30e");
    expect(hashSource("héllo")).not.toBe(hashSource("hello"));
  });

  test("lockKey is a JSON Pointer, so dotted keys stay unambiguous", () => {
    expect(lockKey(["nav", "home"])).toBe("/nav/home");
    expect(lockKey(["nav.home"])).toBe("/nav.home");
    expect(lockKey(["items", 0])).toBe("/items/0");
    expect(lockKey(["a/b", "c~d"])).toBe("/a~1b/c~0d");
  });
});

describe("lockPathFor / readLock / writeLock", () => {
  let dir: string;
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "tl-lock-test-"))); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("one lock per target under <git root>/.tl/locks/, mirroring the target's relative path", () => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "public/locales/ar"), { recursive: true });
    expect(lockPathFor(join(dir, "public/locales/ar/common.json"))).toBe(join(dir, ".tl/locks/public/locales/ar/common.json.lock"));
  });

  test("a .git file (worktree / submodule) also marks the root", () => {
    writeFileSync(join(dir, ".git"), "gitdir: elsewhere\n");
    mkdirSync(join(dir, "i18n"));
    expect(lockPathFor(join(dir, "i18n/ar.yaml"))).toBe(join(dir, ".tl/locks/i18n/ar.yaml.lock"));
  });

  test("a symlinked target resolves to the same lock as its real path", () => {
    mkdirSync(join(dir, ".git"));
    mkdirSync(join(dir, "locales"));
    writeFileSync(join(dir, "locales/ar.json"), "{}\n");
    symlinkSync(join(dir, "locales/ar.json"), join(dir, "ar-link.json"));
    expect(lockPathFor(join(dir, "ar-link.json"))).toBe(lockPathFor(join(dir, "locales/ar.json")));
  });

  test("without a .git ancestor, .tl/locks/ sits in the target's directory", () => {
    mkdirSync(join(dir, "out"));
    expect(lockPathFor(join(dir, "out/ar.json"))).toBe(join(dir, "out/.tl/locks/ar.json.lock"));
  });

  test("readLock returns null when the lock does not exist", () => {
    expect(readLock(join(dir, ".tl/locks/ar.json.lock"))).toBeNull();
  });

  test("writeLock creates parent directories and round-trips", () => {
    const p = join(dir, ".tl/locks/public/ar.json.lock");
    writeLock(p, { "/b": "2", "/a": "1" });
    expect(readLock(p)).toEqual({ "/a": "1", "/b": "2" });
  });

  test("writes sorted keys, 2-space indent, trailing newline (deterministic for git)", () => {
    const p = join(dir, "ar.json.lock");
    writeLock(p, { "/z": "3", "/a": "1", "/m": "2" });
    expect(readFileSync(p, "utf8")).toBe(
      '{\n  "version": 1,\n  "checksums": {\n    "/a": "1",\n    "/m": "2",\n    "/z": "3"\n  }\n}\n',
    );
  });

  test("write is atomic: no tmp file lingers", () => {
    writeLock(join(dir, "ar.json.lock"), { "/a": "1" });
    expect(readdirSync(dir)).toEqual(["ar.json.lock"]);
  });

  test("corrupt lock throws FILE_PARSE_FAILED whose hint names just that file", () => {
    const p = join(dir, "ar.json.lock");
    writeFileSync(p, "<<<<<<< HEAD\n{}\n");
    try {
      readLock(p);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TlError);
      expect((err as TlError).tag).toBe("FILE_PARSE_FAILED");
      expect((err as TlError).hint).toContain(`Delete ${p}`);
    }
  });

  test("unknown version or bad shape throws FILE_PARSE_FAILED", () => {
    const p = join(dir, "ar.json.lock");
    writeFileSync(p, JSON.stringify({ version: 2, checksums: {} }));
    expect(() => readLock(p)).toThrow(TlError);
    writeFileSync(p, JSON.stringify({ version: 1, checksums: { "/a": 1 } }));
    expect(() => readLock(p)).toThrow(TlError);
    writeFileSync(p, JSON.stringify({ version: 1, files: {} }));
    expect(() => readLock(p)).toThrow(TlError);
  });
});
