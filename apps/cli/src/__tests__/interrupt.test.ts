import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Server } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "../../src/index.ts");

// Signals can't be delivered to a child like this on Windows.
describe.skipIf(process.platform === "win32")("Ctrl+C during a translation", () => {
  let home: string;
  let server: Server<undefined>;
  let generating: Promise<void>;
  let unloads: unknown[];
  let hangUnload = false;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tl-interrupt-"));
    unloads = [];
    let started!: () => void;
    generating = new Promise((r) => (started = r));
    // Fake Ollama: a translation request streams nothing and never ends; an
    // unload (keep_alive: 0) is recorded and answered.
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { keep_alive?: number };
        if (body.keep_alive === 0) {
          unloads.push(body);
          if (hangUnload) await new Promise(() => {});
          return Response.json({ done: true });
        }
        started();
        return new Response(new ReadableStream({ start() {} }));
      },
    });
    mkdirSync(join(home, ".config/tl"), { recursive: true });
    writeFileSync(
      join(home, ".config/tl/config.jsonc"),
      JSON.stringify({ adapter: { local: { endpoint: `http://localhost:${server.port}` } } }),
    );
  });

  afterEach(() => {
    hangUnload = false;
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    it(`${signal} aborts the request, unloads the model and exits ${code}`, async () => {
      const proc = Bun.spawn([process.execPath, CLI, "hello", "--to", "fr"], {
        env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, TL_ADAPTER: "ollama" },
        stdout: "pipe",
        stderr: "pipe",
      });
      await generating;
      const start = Date.now();
      proc.kill(signal);
      expect(await proc.exited).toBe(code);
      expect(Date.now() - start).toBeLessThan(3000);
      expect(unloads).toHaveLength(1);
      expect(await new Response(proc.stderr).text()).toContain("CANCELLED");
    });
  }

  it("exits after ~3 s when the unload hangs", async () => {
    hangUnload = true;
    const proc = Bun.spawn([process.execPath, CLI, "hello", "--to", "fr"], {
      env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, TL_ADAPTER: "ollama" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await generating;
    const start = Date.now();
    proc.kill("SIGINT");
    expect(await proc.exited).toBe(130);
    expect(Date.now() - start).toBeGreaterThanOrEqual(2900);
    expect(Date.now() - start).toBeLessThan(6000);
  });

  it("a second SIGINT exits without waiting for the unload", async () => {
    hangUnload = true;
    const proc = Bun.spawn([process.execPath, CLI, "hello", "--to", "fr"], {
      env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, TL_ADAPTER: "ollama" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await generating;
    proc.kill("SIGINT");
    while (unloads.length === 0) await Bun.sleep(10);
    const start = Date.now();
    proc.kill("SIGINT");
    expect(await proc.exited).toBe(130);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
