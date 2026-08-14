# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Guidelines for the `tl` translation CLI tool. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## ⛔ MANDATORY BEFORE WRITING ANY CODE

These are non-negotiable. Do them in order before touching a single file:

1. **Create a feature branch** — `git checkout -b feature/<short-description>` from `main`. No exceptions, not even for "small" tasks.
2. **Commit after every logical unit** — one file done, one feature complete, tests passing = commit + push. Do NOT accumulate all work into one commit at the end.
3. **Push after every commit** — `git push` immediately. Never leave commits sitting locally.

Violations of these three rules are not acceptable. Past agents have failed on all three. Do not repeat this.

**Enforce this by checking `git status` and `git branch` before writing any file.**

---

## Project Overview

`tl` is an open-source CLI-first translation tool with optional TUI. Default model: TranslateGemma via Ollama (local). Key features: glossary enforcement, context-aware translation, pluggable model adapters, automatic memory management.

## Commands

```bash
# Install dependencies
bun install

# Run all tests (all packages via Turborepo)
bun run test

# Run tests for a single package
bun test --cwd packages/core
bun test --cwd packages/shared
bun test --cwd packages/adapters

# Run a single test file
bun test packages/core/src/__tests__/pipeline.test.ts

# Real adapter tests (requires running Ollama)
TEST_ADAPTER=1 bun run test

# Build all packages
bun run build

# Run the CLI directly (no build needed)
bun run apps/cli/src/index.ts "hello" --to ar

# Use the `tl` shorthand (one-time setup)
cd apps/cli && bun link
tl "hello" --to ar
```

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Monorepo**: Bun workspaces + Turborepo
- **CLI**: Commander.js
- **TUI**: OpenTUI (React-based terminal UI)
- **Validation**: Zod
- **Testing**: bun:test
- **Database**: SQLite via `bun:sqlite` (glossary + context storage)
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

- **Scope**: `@translate-local/*` — all packages under `packages/` are publishable (`@translate-local/shared`, `@translate-local/core`, `@translate-local/adapters`)
- **Apps** (`apps/cli`, `apps/tui`) are private, not published
- **Subpath exports**: Each package uses the `exports` field for granular imports (e.g., `@translate-local/shared/types`, `@translate-local/core/pipeline`)
- **Peer deps**: `@translate-local/core` and `@translate-local/adapters` peer-depend on `@translate-local/shared`
- **Bun-first**: In dev, `.ts` sources are consumed directly via `exports` — no build step needed

## Versioning & Changelog

- **Unified versioning**: all packages share a single version number, bumped together on each release.
- Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
- A single root `CHANGELOG.md` tracks all changes (no per-package changelogs).
- When completing a feature, bump the version in **all** `package.json` files, the CLI `.version()` string, and update the root `CHANGELOG.md`.
- Format for changelog entries: `## [version] - YYYY-MM-DD` with sections `### Added`, `### Changed`, `### Fixed`, `### Removed`.

## Key Patterns

- **Adapter interface**: All adapters implement `translate()` and `dispose()`. Use `createAdapter(config)` factory; frontends build the config with `toAdapterConfig(coreConfig, backend?)` from `@translate-local/core/config` instead of hand-mapping fields. Adapters do NOT compute glossary coverage — they return `glossaryCoverage: 1, missingTerms: []` and the pipeline computes the real values on the postprocessed text.
- **Config defaults**: live in `@translate-local/shared/constants` (`DEFAULT_MODEL`, `DEFAULT_OLLAMA_URL`, db paths, …). `configSchema` consumes them via per-field `.default()` plus `.prefault({})` on nested objects — never restate a default literal. **Env substitution** (`${VAR}`) always yields a *string*; number/boolean fields opt into conversion with the `envNumber()` / `envBoolean()` helpers in `config.ts`, so the target type drives coercion rather than the env value's appearance. Don't coerce based on the string's shape — that turns a numeric-looking value on a string field into a number and fails validation. `envBoolean()` matches `"true"`/`"false"` literally because `z.coerce.boolean()` is truthiness-based and reads `"false"` as `true`.
- **TaggedError with hints**: Errors use `tag` + `hint` for actionable messages. Follow this pattern for new errors.
- **Glossary XML tags**: `<term translation="target">source</term>` — TranslateGemma's format. Don't change this.
- **Pipeline flow**: Preprocess (tag inject) → Context retrieval → Translate → Validate (glossary check) → Postprocess (tag strip).
- **Image mode**: Pass `imageBase64` in `PipelineOptions` to trigger image translation. In this mode: glossary tag injection is skipped, `source` is set to `""`, and `imageBase64` is forwarded to the adapter unchanged. Context retrieval is also skipped when `queryText` is empty (image-only invocation).
- **Image validation** (CLI and TUI): Before reading an image file, validate (1) extension against the allowed set (`.png .jpg .jpeg .webp .gif .bmp`) and (2) file size ≤ 10 MB — both defined once in `@translate-local/shared/constants` (`IMAGE_EXT_RE`, `IMAGE_EXT_PATTERN`, `IMAGE_MAX_BYTES`). Always call `file.exists()` before `arrayBuffer()`. Use the typed errors: `IMAGE_INVALID_TYPE`, `IMAGE_TOO_LARGE`, `IMAGE_NOT_FOUND`, `IMAGE_READ_FAILED`.
- **Streaming**: `PipelineOptions` accepts `onChunk?: (chunk: string) => void`. When present, the pipeline forwards it on the first attempt only (retries are silent to avoid concatenating tokens across attempts). The adapter sets `stream: true` and calls `onChunk` per token via NDJSON, while still accumulating the full response for postprocessing. Adapters that don't support streaming ignore the field. CLI streams tokens to stdout only when it is a TTY — piped stdout receives exactly the final postprocessed translation once; TUI updates the output pane with a 16ms render throttle.
- **Memory management**: Adapters call `dispose()` to unload models from VRAM. CLI calls it after each translation; TUI on exit. **Exception:** in file mode (see below) the adapter is disposed exactly once after the entire file completes, not per leaf — otherwise every key pays a cold model-load penalty.
- **File mode** (`tl translate --file <path>`): translate a JSON or YAML catalog. Orchestrator at `packages/core/src/files/index.ts` walks every string leaf, masks placeholders with ASCII sentinels (`__TLPH_N__` — prefix/suffix are shared constants; core exposes `sentinelFor()`, and the adapter prompt builder derives its enforcement regexes from the same constants), runs the per-leaf pipeline, validates placeholders survived (multiset equality), then atomic-writes (tmp+rename) to the output path. **Refuse-by-default** for ARB / xcstrings / FormatJS-with-ICU / Lingui-full — escape hatch is `--format raw-json` with a documented "may corrupt metadata" warning. **Default sync mode** is `missing-only`: translate keys that are absent, empty `""`, `null`, or whitespace-only. `--force` re-translates all leaves. **Skip heuristics** (`packages/core/src/files/skip.ts`) pass through URLs, emails, semver, single chars, and ALL-CAPS short tokens unchanged unless `--translate-all`. **Validate-before-rename:** `writeJson`/`writeYaml` re-parse the tmp file before the rename — a malformed serialization can never replace the existing target. Glossary entries are pre-fetched once per file and threaded through `runPipeline` via `glossaryEntries` so the per-leaf hot path doesn't re-query SQLite. Error tags live in `packages/shared/src/errors.ts`: `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_PARSE_FAILED`, `FILE_WRITE_FAILED`, `FILE_INVALID_FORMAT`, `PLACEHOLDER_MISMATCH`, `SAME_LOCALE`. **Never write over the source:** `resolve(sourcePath) === resolve(outPath)` is refused with `SAME_LOCALE`, because the language check can't fire when `sourceLang` is `auto`. YAML is fully implemented (`files/yaml.ts`) — comments, scalar styles, and key order round-trip via the `yaml` package's Document API. Update block scalars through `setScalarValue()`, never by assigning `Scalar.value` directly: chomping (`|` vs `|-` vs `|+`) is derived from the value's trailing newlines, and translated text has none.
- **MockAdapter**: Available via `createMockAdapter()` from `@translate-local/adapters`. Performs deterministic glossary substitution — use it in unit/integration tests to avoid needing Ollama.
- **CLI command boilerplate**: wrap command actions in `runAction()` and open stores with `withStore()` from `apps/cli/src/utils/run.ts` — don't hand-roll try/catch/formatError/exit per command. Bulk glossary inserts go through `GlossaryStore.addMany()` (one transaction, not one commit per row).
- **RTL helpers**: `isRtlLang()` / `hasRtlChars()` / `RTL_LANGS` live in `@translate-local/shared/utils/language` — don't redefine RTL sets or char-class regexes in the apps.
- **Prompt builders** (`packages/adapters/src/base.ts`): `buildStructuredPrompt(request)` produces the TranslateGemma XML-style prompt and returns `{ prompt, system? }`. `buildNaturalPrompt(request)` produces a generic instruction-style prompt string for non-TranslateGemma models.

## Testing

- Unit + integration tests (pipeline, SQLite, MockAdapter) always run: `bun run test`
- Adapter tests (real Ollama): `TEST_ADAPTER=1 bun run test`
- CLI tests: spawn binary, assert stdout/exit codes

## Reference Docs

- `docs/cli-reference.md` — full command and flag reference
- `docs/glossary-guide.md` — CSV format, domain filtering, advanced usage
- `docs/context-guide.md` — TF-IDF retrieval, tokenization, tuning parameters
- `docs/tui-guide.md` — terminal UI keybindings and workflows
- `docs/adapter-development.md` — guide for adding new model backends

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 4a. Verification Before Every Commit

**Never commit until all checks pass. Fix, then commit.**

Before committing any change, run all of the following in order:

1. **Build**: `bun run build` — must succeed with no errors
2. **Tests**: `bun run test` — all tests must pass (0 failures)
3. **Smoke test the CLI**: run `tl` commands relevant to the changed code and confirm expected output
   - If the CLI binary isn't built yet for the phase, skip step 3 and note it explicitly
4. **Adapter tests** (when Ollama-facing adapter code changed): `TEST_ADAPTER=1 bun run test`

If any check fails: fix the issue, re-run all checks, then commit.
Do not commit with failing tests, build errors, or broken CLI commands.

## 5. Git Workflow

**Use branches. Keep main clean. Write meaningful commits. Commit regularly.**

Branch strategy:
- `main` is the stable, deployable branch. **Never commit directly to it — not even a single line.**
- **Always create a feature branch before starting any work**, even small tasks. Do this as the very first step — before reading files, before planning, before writing anything.
- Create feature branches from `main`: `feature/<short-description>` (e.g., `feature/phase-2-adapters`).
- Use `fix/<short-description>` for bug fixes, `chore/<short-description>` for non-feature work.
- Keep branches short-lived. Merge back to `main` promptly via PR.

Commits — commit early and often:
- **Commit after each logical unit of work** — don't accumulate all changes into one giant commit at the end. Past agents have done this and it is wrong.
- A "logical unit" can be: one file implemented, one feature complete, tests passing, a bug fixed.
- After each commit, immediately push. Don't batch pushes.
- Write clear, concise commit messages: imperative mood, under 72 chars for the subject.
- If a commit needs a body, separate it from the subject with a blank line.
- Good: `Add MockAdapter with deterministic glossary substitution`
- Bad: `updates`, `fix stuff`, `wip`, `done`

Push regularly:
- **Push your branch to remote after every commit** (or at minimum at the end of each working session). Don't let local commits sit unpushed.
- Use `git push -u origin <branch>` on first push; `git push` thereafter.

Merging:
- Merge feature branches into `main` via PR or after verification.
- Delete branches after merging.
- Resolve conflicts carefully — investigate before discarding changes.

## 6. Documentation Maintenance

**Keep project docs accurate as the project evolves.**

After completing a feature or significant change:
- Update `CLAUDE.md` if new patterns, conventions, or guidelines emerged.
- Don't let docs drift from reality — stale docs are worse than no docs.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and git history is clean and meaningful.