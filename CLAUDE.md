# CLAUDE.md

Guidelines for the `tl` translation CLI tool. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Project Overview

`tl` is an open-source CLI-first translation tool with optional TUI. Default model: TranslateGemma via Ollama (local) or HuggingFace API. Key features: glossary enforcement, context-aware translation, pluggable model adapters, automatic memory management.

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
├── packages/adapters/   # TranslateGemma (local/HF), mock
├── apps/cli/            # Commander.js CLI (`tl` command)
└── apps/tui/            # Interactive terminal UI
```

## npm Scope & Publishing

- **Scope**: `@tl/*` — all packages under `packages/` are publishable (`@tl/shared`, `@tl/core`, `@tl/adapters`)
- **Apps** (`apps/cli`, `apps/tui`) are private, not published
- **Subpath exports**: Each package uses the `exports` field for granular imports (e.g., `@tl/shared/types`, `@tl/core/pipeline`)
- **Peer deps**: `@tl/core` and `@tl/adapters` peer-depend on `@tl/shared`
- **Bun-first**: In dev, `.ts` sources are consumed directly via `exports` — no build step needed

## Key Patterns

- **Adapter interface**: All adapters implement `translate()` and `dispose()`. Use `createAdapter(config)` factory.
- **TaggedError with hints**: Errors use `tag` + `hint` for actionable messages. Follow this pattern for new errors.
- **Glossary XML tags**: `<term translation="target">source</term>` — TranslateGemma's format. Don't change this.
- **Pipeline flow**: Preprocess (tag inject) → Context retrieval → Translate → Validate (glossary check) → Postprocess (tag strip).
- **Memory management**: Adapters call `dispose()` to unload models from VRAM. CLI calls it after each translation; TUI on exit.

## Testing

- Unit tests always run: `bun run test`
- Integration tests (pipeline + SQLite): `TEST_INTEGRATION=1 bun run test`
- Adapter tests (real Ollama/HF): `TEST_ADAPTER=1 bun run test`
- CLI tests: spawn binary, assert stdout/exit codes

## Reference Docs

- `docs/product-spec.md` — data models, CLI commands, user workflows
- `docs/implementation-plan.md` — architecture, pipeline flow, config schema
- `docs/plan.md` — implementation phases and verification steps
- `docs/tasks.md` — task checklist by phase
- `docs/translategemma-research.md` — model details, prompt format, glossary approach
- `docs/better-context-analysis.md` — patterns borrowed from better-context (btca)

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

## 5. Git Workflow

**Use branches. Keep main clean. Write meaningful commits.**

Branch strategy:
- `main` is the stable, deployable branch. Never commit directly to it.
- Create feature branches from `main`: `feature/<short-description>` (e.g., `feature/user-auth`).
- Use `fix/<short-description>` for bug fixes, `chore/<short-description>` for non-feature work.
- Keep branches short-lived. Merge back to `main` promptly.

Commits:
- Write clear, concise commit messages: imperative mood, under 72 chars for the subject.
- One logical change per commit. Don't bundle unrelated changes.
- If a commit needs a body, separate it from the subject with a blank line.
- Good: `Add email validation to signup form`
- Bad: `updates`, `fix stuff`, `wip`

Merging:
- Merge feature branches into `main` via PR or after verification.
- Delete branches after merging.
- Resolve conflicts carefully — investigate before discarding changes.

## 6. Documentation Maintenance

**Keep project docs accurate as the project evolves.**

After completing a feature or significant change:
- Update `CLAUDE.md` if new patterns, conventions, or guidelines emerged.
- Update `AGENTS.md` if agent workflows, roles, or coordination changed.
- Don't let docs drift from reality — stale docs are worse than no docs.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and git history is clean and meaningful.