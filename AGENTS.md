# AGENTS.md

Guidelines for agent-based workflows on the `tl` translation CLI project.

## General Principles

- **Read before acting.** Always read relevant files and understand context before making changes.
- **Follow CLAUDE.md.** All coding guidelines in `CLAUDE.md` apply to agent work.
- **Read the docs.** Before implementing a feature, read the relevant docs in `docs/` — especially `product-spec.md` and `implementation-plan.md`.
- **One task at a time.** Focus on the current task. Don't drift into adjacent improvements.
- **Verify your work.** Run tests, check builds, and confirm the task is complete before moving on.

## Git Workflow for Agents

- Always work on a feature branch, never directly on `main`.
- Create the branch before starting work: `git checkout -b feature/<name>`.
- Make atomic commits with clear messages as you progress.
- When the feature is complete and verified, merge to `main`.
- Delete the feature branch after merging.

## Project-Specific Rules

- **Bun, not Node.** Use `bun` for all commands (`bun install`, `bun run test`, `bun run build`). Never use `npm` or `yarn`.
- **bun:sqlite for storage.** Glossary and context use SQLite via `bun:sqlite`. No external DB dependencies.
- **Adapter pattern.** New model backends must implement the `ModelAdapter` interface (`translate()` + `dispose()`). Register in factory.
- **TaggedError.** All user-facing errors must use `TlError` with a `tag` and `hint`. No raw `throw new Error()`.
- **Glossary XML format.** `<term translation="target">source</term>` — this is TranslateGemma's format. Preserve it.
- **Test gates.** Unit tests always run. Integration tests behind `TEST_INTEGRATION=1`. Adapter tests behind `TEST_ADAPTER=1`. Don't skip gates.

## Implementation Phases

Work follows the phases in `docs/plan.md`:
1. Foundation (shared types, errors, utils)
2. Adapters (mock, TranslateGemma local/HF)
3. Core Pipeline (config, glossary, pipeline)
4. CLI (commands, formatters)
5. Context System (TF-IDF indexer)
6. TUI (interactive views)
7. Documentation

Complete phases in order. Each phase should build and test before starting the next.

## Task Completion Checklist

Before marking a task as done:
1. Code compiles: `bun run build`
2. Tests pass: `bun run test`
3. Changes are committed with meaningful messages.
4. Branch is merged to `main` (if the feature is complete).
5. Update `CLAUDE.md` if new conventions or patterns were introduced.
6. Update `AGENTS.md` if agent workflows or coordination changed.

## Agent Coordination

- If multiple agents work on the same codebase, each should use a separate branch.
- Communicate changes via commit messages and PR descriptions — keep them descriptive.
- Avoid overlapping file edits. If conflict is likely, coordinate before starting.

## Error Handling

- If blocked, surface the issue clearly — don't retry the same failing approach.
- If a task is ambiguous, ask for clarification before proceeding.
- If you break something, fix it before moving on. Don't leave the codebase worse than you found it.
