# Contributing

## Dev Setup

```bash
# 1. Clone the repo
git clone https://github.com/its-magdy/translate-local.git
cd translate-local

# 2. Install dependencies (Bun is required)
bun install

# 3. Run all tests
bun run test
```

No build step is required for development — Bun runs TypeScript sources directly.

## Branch Strategy

- `main` is the stable branch. **Never commit directly to it.**
- Create a feature branch before starting any work:

  ```bash
  git checkout -b feature/<short-description>   # new features
  git checkout -b fix/<short-description>        # bug fixes
  git checkout -b chore/<short-description>      # non-feature work
  ```

- Keep branches short-lived. Open a PR to merge back into `main`.
- Delete the branch after merging.

## Running Tests

```bash
# Unit tests (always run)
bun run test

# Integration tests (pipeline + SQLite)
TEST_INTEGRATION=1 bun run test

# Adapter tests (real Ollama — requires a running service)
TEST_ADAPTER=1 bun run test
```

## Pre-Commit Checklist

Before committing any change, run all of these in order:

1. **Build** — `bun run build` must succeed with no errors
2. **Tests** — `bun run test` must pass (0 failures)
3. **Smoke test** — run relevant `tl` commands and confirm expected output
4. **Integration tests** (when your change touches the pipeline or SQLite) — `TEST_INTEGRATION=1 bun run test`

If any check fails, fix the issue and re-run before committing.

## Commit Style

- Imperative mood, under 72 characters: `Add strict glossary retry logic`
- One logical unit per commit — don't batch everything into one commit
- Push after every commit: `git push`

## PR Requirements

- Title: concise, imperative, under 72 characters
- Description: what changed and why
- All tests passing (CI must be green)
- No direct commits to `main`

## Monorepo Structure

```
packages/shared/    @translate-local/shared    — Types, errors, constants, utils
packages/core/      @translate-local/core      — Config, glossary, pipeline, context
packages/adapters/  @translate-local/adapters  — Adapter implementations
apps/cli/           (private)     — Commander.js CLI
apps/tui/           (private)     — Terminal UI
```

All packages share a unified version. When your change warrants a release, bump the version in all `package.json` files together and add an entry to the root `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format.

## Useful Links

- [CLI Reference](docs/cli-reference.md)
- [Adapter Development](docs/adapter-development.md)
- [Glossary Guide](docs/glossary-guide.md)
- [Context Guide](docs/context-guide.md)
- [TUI Guide](docs/tui-guide.md)
