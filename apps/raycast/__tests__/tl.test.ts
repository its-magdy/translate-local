import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { buildTranslateArgs, translate, TlCommandError } from "../src/lib/tl";
import { execFile } from "child_process";

const mockExecFile = vi.mocked(execFile);

describe("buildTranslateArgs", () => {
  it("builds correct args with all options", () => {
    const args = buildTranslateArgs({
      text: "hello",
      to: "ar",
      from: "en",
      glossaryMode: "strict",
      imagePath: "/tmp/img.png",
    });
    expect(args).toEqual([
      "translate", "hello", "--to", "ar", "--json",
      "--from", "en",
      "--glossary", "strict",
      "--image", "/tmp/img.png",
    ]);
  });

  it("builds minimal args with just text and to", () => {
    const args = buildTranslateArgs({ text: "hello", to: "ar" });
    expect(args).toEqual(["translate", "hello", "--to", "ar", "--json"]);
  });
});

describe("translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses JSON stdout correctly", async () => {
    const result = {
      translated: "مرحبا",
      sourceLang: "en",
      targetLang: "ar",
      glossaryCoverage: 1.0,
      missingTerms: [],
      metadata: { adapter: "translate-gemma", durationMs: 120, retries: 0 },
    };
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      callback(null, { stdout: JSON.stringify(result), stderr: "" });
      return undefined as any;
    });

    const output = await translate({ text: "hello", to: "ar" });
    expect(output).toEqual(result);
  });

  it("throws TlCommandError when stderr contains TlError JSON", async () => {
    const tlError = { tag: "GLOSSARY_NOT_FOUND", message: "No glossary", hint: "Add glossary entries first" };
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      const err = Object.assign(new Error("process failed"), { stderr: JSON.stringify(tlError) });
      callback(err, { stdout: "", stderr: JSON.stringify(tlError) });
      return undefined as any;
    });

    await expect(translate({ text: "hello", to: "ar" })).rejects.toThrow(TlCommandError);
    await expect(translate({ text: "hello", to: "ar" })).rejects.toMatchObject({
      tag: "GLOSSARY_NOT_FOUND",
      hint: "Add glossary entries first",
    });
  });

  it("throws generic TlCommandError for non-JSON stderr", async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb?: any) => {
      const callback = cb || _opts;
      const err = Object.assign(new Error("process failed"), { stderr: "some raw error text" });
      callback(err, { stdout: "", stderr: "some raw error text" });
      return undefined as any;
    });

    await expect(translate({ text: "hello", to: "ar" })).rejects.toThrow(TlCommandError);
    await expect(translate({ text: "hello", to: "ar" })).rejects.toMatchObject({
      tag: "CLI_ERROR",
    });
  });
});
