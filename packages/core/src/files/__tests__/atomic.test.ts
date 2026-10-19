import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { atomicWriteFile } from "../atomic";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tl-atomic-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  test("writes file in place via rename", () => {
    const p = join(dir, "x.json");
    atomicWriteFile(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
  });

  test("does not leave .tmp-<pid> after success", () => {
    const p = join(dir, "x.json");
    atomicWriteFile(p, "hello");
    const tmp = join(dir, `.x.json.tmp-${process.pid}`);
    expect(existsSync(tmp)).toBe(false);
  });

  test("does not corrupt existing file on rename failure", () => {
    // Write existing file
    const p = join(dir, "x.json");
    writeFileSync(p, "original");
    // Try to write to a non-existent directory — error caught; original intact
    const bad = join(dir, "missing", "nested", "x.json");
    expect(() => atomicWriteFile(bad, "new")).toThrow();
    expect(readFileSync(p, "utf8")).toBe("original");
  });

  test("validate runs before rename: failed validation preserves existing target", () => {
    const p = join(dir, "x.json");
    writeFileSync(p, "original");
    const tmp = join(dir, `.x.json.tmp-${process.pid}`);
    expect(() =>
      atomicWriteFile(p, "garbage", () => {
        throw new Error("malformed");
      }),
    ).toThrow(/malformed/);
    expect(readFileSync(p, "utf8")).toBe("original");
    expect(existsSync(tmp)).toBe(false);
  });
});
