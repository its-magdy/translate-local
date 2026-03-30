# CLAUDE.md

Primary guidelines for all agents working on the `tl` translation CLI project. This is the source of truth — Claude Code and other agent systems should follow these rules.

---

## ⛔ MANDATORY BEFORE WRITING ANY CODE

1. **Create a feature branch** — `git checkout -b feature/<short-description>` from `main`. No exceptions.
2. **Commit after every logical unit** — one file done, one feature complete, tests passing = commit + push. Do NOT accumulate all work into one commit.
3. **Push after every commit** — `git push` immediately. Never leave commits sitting locally.

Check `git status` and `git branch` before writing any file.

---

## Project Overview

`tl` is an open-source CLI-first translation tool with optional TUI. Default model: TranslateGemma via Ollama (local). Key features: glossary enforcement, context-aware translation, pluggable model adapters, automatic memory management.

## Commands

```bash
bun install
bun run test
bun test --cwd packages/core
bun test --cwd packages/shared
bun test --cwd packages/adapters
bun test packages/core/src/__tests__/pipeline.test.ts
TEST_INTEGRATION=1 bun run test
TEST_ADAPTER=1 bun run test
bun run build
bun run apps/cli/src/index.ts "hello" --to ar
```

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Monorepo**: Bun workspaces + Turborepo
- **CLI**: Commander.js
- **TUI**: OpenTUI (React-based terminal UI)
- **Validation**: Zod
- **Testing**: bun:test
- **Database**: SQLite via `bun:sqlite`
- **Config**: JSONC at `~/.config/tl/config.jsonc`

## Monorepo Structure

```
t/
├── packages/shared/     # Types, errors, constants, utils
├── packages/core/       # Config, glossary, pipeline, context
├── packages/adapters/   # TranslateGemma (local), mock
├── apps/cli/            # Commander.js CLI (`tl` command)
└── apps/tui/            # Interactive terminal UI
```

## npm Scope & Publishing

- Scope: `@tl/*` — packages are publishable, apps are private
- Subpath exports point to `.ts` source directly (Bun-first, no build for dev)
- `@tl/core` and `@tl/adapters` peer-depend on `@tl/shared`

## Versioning & Changelog

- Each package maintains its own `CHANGELOG.md` (Keep a Changelog format)
- Versions follow Semantic Versioning; starting at `0.1.0`
- Bump affected package versions and update `CHANGELOG.md` when completing a feature

## Key Patterns

- **Adapter interface**: All adapters implement `translate()` and `dispose()`. Use `createAdapter(config)` factory.
- **TaggedError with hints**: Errors use `TlError` with `tag` + `hint`. No raw `throw new Error()`. Add new tags to `ErrorTag` union in `packages/shared/src/errors.ts`.
- **Glossary XML tags**: `<term translation="target">source</term>` — TranslateGemma's format. Don't change this.
- **Pipeline flow**: Preprocess (tag inject) → Context retrieval → Translate → Validate (glossary check) → Postprocess (tag strip).
- **Image mode**: Pass `imageBase64` in `PipelineOptions`. Glossary tag injection is skipped, `source` is `""`, context retrieval skipped when `queryText` is empty.
- **Image validation**: Validate extension (`.png .jpg .jpeg .webp .gif .bmp`) and size ≤ 10 MB before reading. Call `file.exists()` before `arrayBuffer()`. Use typed errors: `IMAGE_INVALID_TYPE`, `IMAGE_TOO_LARGE`, `IMAGE_NOT_FOUND`, `IMAGE_READ_FAILED`.
- **Streaming**: `PipelineOptions` accepts `onChunk?: (chunk: string) => void`. Forwarded on first attempt only (not retries). Adapter sets `stream: true` and calls `onChunk` per token via NDJSON while accumulating the full response. CLI writes tokens to stdout; TUI updates output pane with 16ms render throttle.
- **Memory management**: `dispose()` unloads models from VRAM. CLI calls it after each translation; TUI on exit.
- **MockAdapter**: `createMockAdapter()` from `@tl/adapters` — deterministic glossary substitution for unit/integration tests.
- **Prompt builders** (`packages/adapters/src/base.ts`): `buildStructuredPrompt(request)` → TranslateGemma XML-style prompt. `buildNaturalPrompt(request)` → generic instruction-style prompt string.

## Testing

- Unit tests always run: `bun run test`
- Integration tests (pipeline + SQLite): `TEST_INTEGRATION=1 bun run test`
- Adapter tests (real Ollama): `TEST_ADAPTER=1 bun run test`
- CLI tests: spawn binary, assert stdout/exit codes

## Reference Docs

- `docs/product-spec.md` — data models, CLI commands, user workflows
- `docs/implementation-plan.md` — architecture, pipeline flow, config schema
- `docs/plan.md` — implementation phases and verification steps
- `docs/tasks.md` — task checklist by phase
- `docs/translategemma-research.md` — model details, prompt format, glossary approach
- `docs/better-context-analysis.md` — patterns borrowed from better-context (btca)

---

## General Principles

- **Read before acting.** Always read relevant files and understand context before making changes.
- **Read the docs.** Before implementing a feature, read relevant docs in `docs/`.
- **One task at a time.** Don't drift into adjacent improvements.
- **Think before coding.** State assumptions explicitly. If uncertain, ask. If simpler approach exists, say so.
- **Simplicity first.** Minimum code that solves the problem. No speculative features or abstractions.
- **Surgical changes.** Touch only what you must. Match existing style. Don't refactor things that aren't broken.
- **Goal-driven execution.** Define success criteria. Loop until verified.

## Git Workflow

- Always work on a feature branch, never directly on `main`.
- Create the branch before starting work: `git checkout -b feature/<name>`.
- Make atomic commits with clear messages as you progress — commit early and often.
- Push after every commit. Don't let local commits sit unpushed.
- Merge to `main` via PR after verification. Delete the branch after merging.
- Good commit messages: imperative mood, under 72 chars. e.g. `Add MockAdapter with deterministic glossary substitution`

## Verification Before Every Commit

Run all checks in order before committing:

1. `bun run build` — must succeed with no errors
2. `bun run test` — all tests must pass
3. Smoke test the CLI for changed code
4. `TEST_INTEGRATION=1 bun run test` (when applicable)

Do not commit with failing tests, build errors, or broken CLI commands.

## Implementation Phases

Work follows phases in `docs/plan.md`:
1. Foundation (shared types, errors, utils)
2. Adapters (mock, TranslateGemma local)
3. Core Pipeline (config, glossary, pipeline)
4. CLI (commands, formatters)
5. Context System (TF-IDF indexer)
6. TUI (interactive views)
7. Documentation

Complete phases in order. Each phase should build and test before starting the next.

## Task Completion Checklist

Before marking a task done:
1. `bun run build` — compiles cleanly
2. `bun run test` — all tests pass
3. Changes committed with meaningful messages
4. Branch merged to `main` (if feature is complete)
5. Update `CLAUDE.md` if new patterns, conventions, or workflows emerged

## Agent Coordination

- Multiple agents must each use a separate branch.
- Communicate changes via commit messages and PR descriptions — keep them descriptive.
- Avoid overlapping file edits. If conflict is likely, coordinate before starting.

## Error Handling

- If blocked, surface the issue clearly — don't retry the same failing approach.
- If a task is ambiguous, ask for clarification before proceeding.
- If you break something, fix it before moving on.
