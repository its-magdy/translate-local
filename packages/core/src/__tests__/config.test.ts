import { describe, it, expect } from "bun:test";
import { loadConfig, saveConfig, configSchema } from "../config";
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
    process.env.TEST_TL_ENDPOINT = "http://myhost:11434";
    writeFileSync(p, '{ "adapter": { "local": { "endpoint": "${TEST_TL_ENDPOINT}" } } }');
    const cfg = loadConfig(p);
    expect(cfg.adapter.local.endpoint).toBe("http://myhost:11434");
    delete process.env.TEST_TL_ENDPOINT;
    rmSync(dir, { recursive: true });
  });

  it("env values containing backslashes and quotes round-trip intact", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_WINPATH = 'C:\\models\\a "quoted" name';
    writeFileSync(p, '{ "adapter": { "local": { "model": "${TEST_TL_WINPATH}" } } }');
    const cfg = loadConfig(p);
    expect(cfg.adapter.local.model).toBe('C:\\models\\a "quoted" name');
    delete process.env.TEST_TL_WINPATH;
    rmSync(dir, { recursive: true });
  });

  it("whole-value ${VAR} adopts numeric and boolean types", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_RETRIES = "3";
    process.env.TEST_TL_KEEPALIVE = "true";
    writeFileSync(p, '{ "glossary": { "maxRetries": "${TEST_TL_RETRIES}" }, "adapter": { "local": { "keepAlive": "${TEST_TL_KEEPALIVE}" } } }');
    const cfg = loadConfig(p);
    expect(cfg.glossary.maxRetries).toBe(3);
    expect(cfg.adapter.local.keepAlive).toBe(true);
    delete process.env.TEST_TL_RETRIES;
    delete process.env.TEST_TL_KEEPALIVE;
    rmSync(dir, { recursive: true });
  });

  it("keeps numeric-looking env values as strings for string fields", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_MODEL = "2";
    process.env.TEST_TL_PORTONLY = "8080";
    writeFileSync(p, '{ "adapter": { "local": { "model": "${TEST_TL_MODEL}", "endpoint": "${TEST_TL_PORTONLY}" } } }');
    const cfg = loadConfig(p);
    expect(cfg.adapter.local.model).toBe("2");
    expect(cfg.adapter.local.endpoint).toBe("8080");
    delete process.env.TEST_TL_MODEL;
    delete process.env.TEST_TL_PORTONLY;
    rmSync(dir, { recursive: true });
  });

  it('reads "false" as false for boolean fields', () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_KEEPALIVE = "false";
    writeFileSync(p, '{ "adapter": { "local": { "keepAlive": "${TEST_TL_KEEPALIVE}" } } }');
    const cfg = loadConfig(p);
    expect(cfg.adapter.local.keepAlive).toBe(false);
    delete process.env.TEST_TL_KEEPALIVE;
    rmSync(dir, { recursive: true });
  });

  it("unquoted ${VAR} fails with a hint pointing at the quoted form", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    process.env.TEST_TL_RETRIES = "3";
    writeFileSync(p, '{ "glossary": { "maxRetries": ${TEST_TL_RETRIES} } }');
    let err: any;
    try { loadConfig(p); } catch (e) { err = e; }
    expect(err?.tag).toBe("CONFIG_INVALID");
    expect(err?.hint).toContain('quoted string');
    delete process.env.TEST_TL_RETRIES;
    rmSync(dir, { recursive: true });
  });

  it("throws CONFIG_INVALID for unset env var", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    delete process.env.UNSET_TL_VAR;
    writeFileSync(p, '{ "adapter": { "local": { "endpoint": "${UNSET_TL_VAR}" } } }');
    let err: any;
    try { loadConfig(p); } catch (e) { err = e; }
    expect(err?.tag).toBe("CONFIG_INVALID");
    rmSync(dir, { recursive: true });
  });

  it("preserves URLs in config values (stripJsoncComments string safety)", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    writeFileSync(p, `{
      // endpoint with URL containing //
      "adapter": { "local": { "endpoint": "http://localhost:11434" } }
    }`);
    const cfg = loadConfig(p);
    expect(cfg.adapter.local.endpoint).toBe("http://localhost:11434");
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

  it("saveConfig round-trip preserves values", () => {
    const dir = join(tmpdir(), `tl-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "config.jsonc");
    const original = configSchema.parse({ glossary: { mode: "strict" }, defaults: { targetLang: "fr" } });
    saveConfig(original, p);
    const loaded = loadConfig(p);
    expect(loaded.glossary.mode).toBe("strict");
    expect(loaded.defaults.targetLang).toBe("fr");
    rmSync(dir, { recursive: true });
  });
});
