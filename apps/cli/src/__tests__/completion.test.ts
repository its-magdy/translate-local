import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Command } from "commander";

import { SUPPORTED_LANGUAGES } from "@translate-local/shared/constants";
import { SPEC } from "../completions/spec";
import { generateBash } from "../completions/bash";
import { generateZsh } from "../completions/zsh";
import { generateFish } from "../completions/fish";

import { makeTranslateCommand } from "../commands/translate";
import { makeGlossaryCommand } from "../commands/glossary";
import { makeContextCommand } from "../commands/context";
import { makeConfigCommand } from "../commands/config";
import { makeLanguagesCommand } from "../commands/languages";
import { makeCompletionCommand } from "../commands/completion";

const CLI = join(import.meta.dir, "../../src/index.ts");

// Try a shell-syntax checker. If the binary isn't installed (typical in CI),
// the test is skipped — we don't want a missing fish to fail the suite.
function shellSyntaxCheck(bin: string, args: string[]): "ok" | "fail" | "missing" {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
  return r.status === 0 ? "ok" : "fail";
}

describe("tl completion", () => {
  describe("CLI integration", () => {
    it("rejects unknown shells", () => {
      const cmd = makeCompletionCommand().exitOverride();
      expect(() => cmd.parse(["tcsh"], { from: "user" })).toThrow();
    });

    it("requires a shell argument", () => {
      const cmd = makeCompletionCommand().exitOverride();
      expect(() => cmd.parse([], { from: "user" })).toThrow();
    });

    // One end-to-end spawn confirms the bin is wired into index.ts and exits 0.
    // The other shells are exercised in-process below; spawning them all would
    // pay 3x cold-Bun startup for no extra signal.
    it("end-to-end: `bun run tl completion bash` produces output and exits 0", () => {
      const r = spawnSync("bun", ["run", CLI, "completion", "bash"], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      });
      expect(r.status).toBe(0);
      expect((r.stdout ?? "").length).toBeGreaterThan(500);
    });
  });

  describe.each([
    ["bash", generateBash],
    ["zsh", generateZsh],
    ["fish", generateFish],
  ] as const)("%s output", (_shell, generate) => {
    const out = generate();

    // Word-boundary regex avoids false positives — bare `toContain("ar")`
    // would match `_arguments`, `cargs`, `share`; `toContain("en")` matches
    // `completion`/`Open`; `toContain("fr")` matches `from`. If the language
    // list were dropped from output entirely, those substring checks would
    // still pass.
    const hasToken = (s: string, token: string) =>
      new RegExp(`(?<![A-Za-z0-9_-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`).test(s);

    it("includes every top-level command name", () => {
      for (const cmd of SPEC.commands) {
        expect(hasToken(out, cmd.name)).toBe(true);
      }
    });

    it("includes every glossary subcommand", () => {
      for (const sub of ["add", "list", "remove", "import", "export"]) {
        expect(hasToken(out, sub)).toBe(true);
      }
    });

    it("includes a sample of language codes", () => {
      for (const lang of ["ar", "en", "fr", "ja", "zh-tw"]) {
        expect(hasToken(out, lang)).toBe(true);
      }
    });

    it("includes glossary mode choices", () => {
      expect(hasToken(out, "prefer")).toBe(true);
      expect(hasToken(out, "strict")).toBe(true);
    });

    it("includes file format choices", () => {
      for (const fmt of ["raw-json", "raw-yaml"]) {
        expect(hasToken(out, fmt)).toBe(true);
      }
    });
  });

  describe("syntax checks", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), "tl-completion-"));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it("bash output passes `bash -n`", () => {
      const path = join(tmp, "tl.bash");
      writeFileSync(path, generateBash());
      const result = shellSyntaxCheck("bash", ["-n", path]);
      if (result === "missing") return;
      expect(result).toBe("ok");
    });

    it("zsh output passes `zsh -n`", () => {
      const path = join(tmp, "_tl");
      writeFileSync(path, generateZsh());
      const result = shellSyntaxCheck("zsh", ["-n", path]);
      if (result === "missing") return;
      expect(result).toBe("ok");
    });

    it("fish output passes `fish --no-execute`", () => {
      const path = join(tmp, "tl.fish");
      writeFileSync(path, generateFish());
      const result = shellSyntaxCheck("fish", ["--no-execute", path]);
      if (result === "missing") return;
      expect(result).toBe("ok");
    });
  });

  describe("language list parity", () => {
    // Catches the case where someone adds a language to constants.ts but a
    // generator's lang embedding wasn't updated. All three generators embed
    // the list independently, so a regression in any of them must fail here.
    it.each([
      ["bash", generateBash],
      ["zsh", generateZsh],
      ["fish", generateFish],
    ] as const)("%s includes every entry in SUPPORTED_LANGUAGES", (_shell, gen) => {
      const out = gen();
      for (const lang of SUPPORTED_LANGUAGES) {
        const re = new RegExp(`(?<![A-Za-z0-9_-])${lang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`);
        expect(re.test(out)).toBe(true);
      }
    });
  });

  describe("drift detection vs live Commander tree", () => {
    // Asserts spec.ts and the live Commander tree agree on commands, flags,
    // option choices, and positional arguments. The program has to be rebuilt
    // here (rather than imported from index.ts) because index.ts has top-level
    // side effects (auto-launches TUI, calls parseAsync immediately on argv).
    type Pair = string; // "translate:--from" or "glossary.add:--source"

    function buildLiveProgram(): Command {
      const program = new Command().name("tl");
      program.addCommand(makeTranslateCommand());
      program.addCommand(makeGlossaryCommand());
      program.addCommand(makeContextCommand());
      program.addCommand(makeConfigCommand());
      program.addCommand(makeLanguagesCommand());
      program.addCommand(makeCompletionCommand());
      return program;
    }

    function liveOptionPairs(program: Command): Set<Pair> {
      const out = new Set<Pair>();
      for (const cmd of program.commands) {
        const path = cmd.name();
        for (const opt of cmd.options) {
          const longFlag = opt.long ?? opt.short;
          if (longFlag) out.add(`${path}:${longFlag}`);
        }
        for (const sub of cmd.commands) {
          const subPath = `${path}.${sub.name()}`;
          for (const opt of sub.options) {
            const longFlag = opt.long ?? opt.short;
            if (longFlag) out.add(`${subPath}:${longFlag}`);
          }
        }
      }
      return out;
    }

    function specOptionPairs(): Set<Pair> {
      const out = new Set<Pair>();
      for (const cmd of SPEC.commands) {
        for (const opt of cmd.options) {
          if (opt.flag.startsWith("--")) out.add(`${cmd.name}:${opt.flag}`);
        }
        for (const sub of cmd.subcommands ?? []) {
          for (const opt of sub.options) {
            if (opt.flag.startsWith("--")) out.add(`${cmd.name}.${sub.name}:${opt.flag}`);
          }
        }
      }
      return out;
    }

    function liveChoicePairs(program: Command): Map<string, readonly string[]> {
      const out = new Map<string, readonly string[]>();
      const collect = (path: string, cmd: Command) => {
        for (const opt of cmd.options) {
          const longFlag = opt.long ?? opt.short;
          if (longFlag && opt.argChoices && opt.argChoices.length > 0) {
            out.set(`${path}:${longFlag}`, [...opt.argChoices].sort());
          }
        }
        for (const arg of cmd.registeredArguments ?? []) {
          if (arg.argChoices && arg.argChoices.length > 0) {
            out.set(`${path}<${arg.name()}>`, [...arg.argChoices].sort());
          }
        }
      };
      for (const cmd of program.commands) {
        collect(cmd.name(), cmd);
        for (const sub of cmd.commands) collect(`${cmd.name()}.${sub.name()}`, sub);
      }
      return out;
    }

    function specChoicePairs(): Map<string, readonly string[]> {
      const out = new Map<string, readonly string[]>();
      const collect = (path: string, cmd: typeof SPEC.commands[number]) => {
        for (const opt of cmd.options) {
          if (opt.flag.startsWith("--") && opt.takes === "choice" && opt.choices) {
            out.set(`${path}:${opt.flag}`, [...opt.choices].sort());
          }
        }
        for (const pos of cmd.positionals ?? []) {
          if (pos.takes === "choice" && pos.choices) {
            out.set(`${path}<${pos.name}>`, [...pos.choices].sort());
          }
        }
      };
      for (const cmd of SPEC.commands) {
        collect(cmd.name, cmd);
        for (const sub of cmd.subcommands ?? []) collect(`${cmd.name}.${sub.name}`, sub);
      }
      return out;
    }

    type PositionalShape = { name: string; required: boolean };

    function livePositionals(program: Command): Map<string, PositionalShape[]> {
      const out = new Map<string, PositionalShape[]>();
      const collect = (path: string, cmd: Command) => {
        const args = (cmd.registeredArguments ?? []).map((a) => ({ name: a.name(), required: a.required }));
        if (args.length > 0) out.set(path, args);
      };
      for (const cmd of program.commands) {
        collect(cmd.name(), cmd);
        for (const sub of cmd.commands) collect(`${cmd.name()}.${sub.name()}`, sub);
      }
      return out;
    }

    function specPositionals(): Map<string, PositionalShape[]> {
      const out = new Map<string, PositionalShape[]>();
      const collect = (path: string, cmd: typeof SPEC.commands[number]) => {
        const args = (cmd.positionals ?? []).map((p) => ({ name: p.name, required: p.required }));
        if (args.length > 0) out.set(path, args);
      };
      for (const cmd of SPEC.commands) {
        collect(cmd.name, cmd);
        for (const sub of cmd.subcommands ?? []) collect(`${cmd.name}.${sub.name}`, sub);
      }
      return out;
    }

    const program = buildLiveProgram();
    const live = liveOptionPairs(program);
    const spec = specOptionPairs();

    it("every live --flag has a SPEC entry", () => {
      const missing = [...live].filter((p) => !spec.has(p));
      expect(missing).toEqual([]);
    });

    it("every SPEC --flag exists on the live command", () => {
      const extra = [...spec].filter((p) => !live.has(p));
      expect(extra).toEqual([]);
    });

    it("top-level command names match", () => {
      const liveNames = program.commands.map((c) => c.name()).sort();
      const specNames = SPEC.commands.map((c) => c.name).sort();
      expect(specNames).toEqual(liveNames);
    });

    it("subcommand names match for grouped commands", () => {
      for (const cmd of SPEC.commands) {
        if (!cmd.subcommands || cmd.subcommands.length === 0) continue;
        const liveCmd = program.commands.find((c) => c.name() === cmd.name);
        expect(liveCmd).toBeDefined();
        const liveSubs = liveCmd!.commands.map((c) => c.name()).sort();
        const specSubs = cmd.subcommands.map((s) => s.name).sort();
        expect(specSubs).toEqual(liveSubs);
      }
    });

    it("argChoices match between SPEC and live tree", () => {
      const liveChoices = liveChoicePairs(program);
      const specChoices = specChoicePairs();
      // Guard against the harmless empty-equals-empty pass.
      expect(specChoices.size).toBeGreaterThan(0);
      expect([...specChoices.keys()].sort()).toEqual([...liveChoices.keys()].sort());
      for (const [key, choices] of specChoices) {
        expect({ key, choices }).toEqual({ key, choices: liveChoices.get(key) ?? [] });
      }
    });

    it("positional arguments match between SPEC and live tree", () => {
      const livePos = livePositionals(program);
      const specPos = specPositionals();
      expect(specPos.size).toBeGreaterThan(0);
      expect([...specPos.keys()].sort()).toEqual([...livePos.keys()].sort());
      for (const [key, args] of specPos) {
        expect({ key, args }).toEqual({ key, args: livePos.get(key) ?? [] });
      }
    });
  });
});
