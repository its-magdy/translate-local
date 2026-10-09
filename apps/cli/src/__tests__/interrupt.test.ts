import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Server } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  // Translation requests answered before the server starts hanging on them.
  let answered = 0;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tl-interrupt-"));
    unloads = [];
    let started!: () => void;
    generating = new Promise((r) => (started = r));
    // Fake Ollama: after `answered` replies, a translation request streams
    // nothing and never ends; an unload (keep_alive: 0) is recorded and answered.
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { keep_alive?: number };
        if (body.keep_alive === 0) {
          unloads.push(body);
          if (hangUnload) await new Promise(() => {});
          return Response.json({ done: true });
        }
        if (answered > 0) {
          answered--;
          return new Response(JSON.stringify({ response: "Bonjour", done: true }) + "\n");
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
    answered = 0;
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

  it("file mode: Ctrl+C keeps the finished keys and a rerun translates the rest", async () => {
    const project = join(home, "project");
    mkdirSync(project);
    writeFileSync(join(project, "en.json"), JSON.stringify({ a: "Hello", b: "Bye", c: "Thanks" }));
    const env = { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, TL_ADAPTER: "ollama" };
    const args = [process.execPath, CLI, "translate", "--file", join(project, "en.json"), "--to", "fr"];
    answered = 1; // "a" completes, "b" hangs until Ctrl+C

    const proc = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
    await generating;
    proc.kill("SIGINT");
    expect(await proc.exited).toBe(130);
    expect(await new Response(proc.stderr).text()).toContain("Interrupted: 2 of 3 key(s) not translated");
    // Never the source text copied into b and c: they stay absent.
    expect(JSON.parse(readFileSync(join(project, "fr.json"), "utf8"))).toEqual({ a: "Bonjour" });
    expect(unloads).toHaveLength(1);

    answered = Infinity;
    const rerun = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
    expect(await rerun.exited).toBe(0);
    expect(await new Response(rerun.stdout).text()).toContain("Translated: 2 /");
    expect(JSON.parse(readFileSync(join(project, "fr.json"), "utf8"))).toEqual({ a: "Bonjour", b: "Bonjour", c: "Bonjour" });
  });

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
