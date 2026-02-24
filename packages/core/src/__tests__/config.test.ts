import { describe, it, expect } from "bun:test";
import { loadConfig, configSchema } from "../config";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("configSchema", () => {
  it("returns defaults for empty object", () => {
    const cfg = configSchema.parse({});
    expect(cfg.adapter.backend).toBe("local");
    expect(cfg.glossary.mode).toBe("prefer");
    expect(cfg.glossary.maxRetries).toBe(2);
    expect(cfg.defaults.targetLang).toBe("ar");
  });

  it("rejects invalid glossary mode", () => {
    expect(() => configSchema.parse({ glossary: { mode: "wrong" } })).toThrow();
  });

  it("rejects maxRetries > 10", () => {
    expect(() => configSchema.parse({ glossary: { maxRetries: 99 } })).toThrow();
  });
});

describe("loadConfig", () => {
  it("returns defaults when config file is missing", () => {
    const cfg = loadConfig("/nonexistent/path/config.jsonc");
    expect(cfg.adapter.backend).toBe("local");
  });

  it("loads a valid JSONC config", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    writeFileSync(
      p,
      `{
        // comment
        "glossary": { "mode": "strict", "maxRetries": 1 },
        "defaults": { "targetLang": "fr" }
      }`,
    );
    const cfg = loadConfig(p);
    expect(cfg.glossary.mode).toBe("strict");
    expect(cfg.glossary.maxRetries).toBe(1);
    expect(cfg.defaults.targetLang).toBe("fr");
    rmSync(dir, { recursive: true });
  });

  it("resolves env vars in config values", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_TOKEN = "test-token-123";
    writeFileSync(p, `{ "adapter": { "huggingface": { "token": "${process.env.TEST_TL_TOKEN}" } } }`);
    const cfg = loadConfig(p);
    expect(cfg.adapter.huggingface.token).toBe("test-token-123");
    delete process.env.TEST_TL_TOKEN;
    rmSync(dir, { recursive: true });
  });

  it("throws CONFIG_INVALID for bad JSON", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    writeFileSync(p, `{ invalid json `);
    let err: any;
    try { loadConfig(p); } catch (e) { err = e; }
    expect(err?.tag).toBe("CONFIG_INVALID");
    rmSync(dir, { recursive: true });
  });
});
