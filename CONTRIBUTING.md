# Contributing

## Dev Setup

```bash
# 1. Clone the repo
git clone https://github.com/its-magdy/translate-local.git
cd translate-local

# 2. Install dependencies (Bun is required; the repo pins Bun 1.4.2 via `packageManager`, and CI uses that version)
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
# Unit + integration tests (pipeline, SQLite, MockAdapter — always run)
bun run test

# Adapter tests (real Ollama — requires a running service)
TEST_ADAPTER=1 bun run test

# One package, or one test file
bun test --cwd packages/core
bun test packages/core/src/__tests__/pipeline.test.ts

# Type-check sources and tests (the build excludes __tests__)
bun run typecheck
```

## Pre-Commit Checklist

Before committing any change, run all of these in order:

1. **Build** — `bun run build` must succeed with no errors
2. **Type-check** — `bun run typecheck` must succeed with no errors
3. **Tests** — `bun run test` must pass (0 failures)
4. **Smoke test** — run relevant `tl` commands and confirm expected output
5. **Adapter tests** (when your change touches Ollama-facing adapter code) — `TEST_ADAPTER=1 bun run test`

If any check fails, fix the issue and re-run before committing.

### Smoke-testing with an isolated HOME

`tl` stores its config and databases under `~/.config/tl`. Run smoke tests against a throwaway home directory so they never touch your real config or glossary (on Windows, `USERPROFILE` plays the role of `HOME`). `TL_ADAPTER=mock` uses the mock adapter, so Ollama is not needed:

```bash
(
  export HOME="$(mktemp -d)"
  export USERPROFILE="$HOME"
  export TL_ADAPTER=mock
  bun run apps/cli/src/index.ts glossary add --source hello --target bonjour --from en --to fr
  bun run apps/cli/src/index.ts "hello world" --from en --to fr
)
```

The subshell keeps the changed `HOME` from leaking into your session. The CLI test suite already isolates its own `HOME`.

## Continuous Integration

CI runs on every pull request and on pushes to `main`:

- **build and typecheck** — `bun run build` and `bun run typecheck` on Linux
- **test** — `bun run test` on Linux, macOS and Windows, plus a smoke test of the compiled host binary
- **ci-ok** — the one required check; it passes only when the jobs above passed

## Commit Style

- Imperative mood, under 72 characters: `Add strict glossary retry logic`
- The history uses a `type(scope):` prefix: `fix(tui): destroy removed renderables`, `docs: ...`, `chore(release): prepare 0.5.3`. Following it is welcome.
- One logical unit per commit — don't batch everything into one commit
- Push after every commit: `git push`

## PR Requirements

- Title: concise, imperative, under 72 characters
- Description: what changed and why (the PR template lists the checks)
- All tests passing (`ci-ok` must be green)
- No direct commits to `main`
- No version bump or `CHANGELOG.md` edit — those happen in the release PR

## Monorepo Structure

```
packages/shared/    @translate-local/shared    — Types, errors, constants, utils
packages/core/      @translate-local/core      — Config, glossary, pipeline, context
packages/adapters/  @translate-local/adapters  — Adapter implementations
apps/cli/           (private)     — Commander.js CLI
apps/tui/           (private)     — Terminal UI
packages/npm-tl*/   @translate-local/tl*       — npm wrapper and per-platform binary packages
```

`shared`, `core` and `adapters` are private workspace packages; the CLI bundles them into the binary. Only `@translate-local/tl` and its per-platform packages are published to npm.

## Releases

All packages share a unified version. Releases are cut by the maintainer, so feature and fix PRs leave versions and the changelog alone:

1. A release PR (`chore(release): prepare X.Y.Z`) bumps the version in every `package.json` and adds an entry to the root `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/) format.
2. After it merges, the maintainer pushes a `vX.Y.Z` tag. The release workflow checks that the tag matches every `package.json`, builds the binaries for five platforms, publishes the npm packages, creates the GitHub Release with a `SHA256SUMS` file, and triggers the Homebrew tap update.

## Security and Conduct

- Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Don't open a public issue for them.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Useful Links

- [CLI Reference](docs/cli-reference.md)
- [Adapter Development](docs/adapter-development.md)
- [Glossary Guide](docs/glossary-guide.md)
- [Context Guide](docs/context-guide.md)
- [TUI Guide](docs/tui-guide.md)
