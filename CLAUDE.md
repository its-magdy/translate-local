# CLAUDE.md

`tl` is an open-source, CLI-first translation tool with an optional TUI. Default model: TranslateGemma via Ollama (local). Key features: glossary enforcement, context-aware translation, pluggable model adapters, automatic memory management.

## ⛔ Git workflow (mandatory, before writing any file)

Past agents broke all three of these rules. Check `git status` and `git branch` before writing anything.

1. **Branch first**: from `main`, create `feature/<desc>`, `fix/<desc>` or `chore/<desc>`. This applies even to one-line changes. `main` only changes through PRs.
2. **Commit after every logical unit**: a file done, a feature complete, tests passing. Use imperative subjects under 72 chars (`Add MockAdapter with deterministic glossary substitution`).
3. **Push after every commit**: `git push -u origin <branch>` the first time, then `git push`.

## Commands

```bash
bun install
bun run test                                  # all packages (Turborepo)
bun test --cwd packages/core                  # one package
bun test packages/core/src/__tests__/pipeline.test.ts   # one file
TEST_ADAPTER=1 bun run test                   # real Ollama adapter tests
bun run build                                 # compile CLI binary to apps/cli/dist/tl (the only build)
bun run typecheck
bun run apps/cli/src/index.ts "hello" --to ar # run the CLI without building
```

## Stack & layout

Bun (not Node), strict TypeScript, Bun workspaces + Turborepo, Commander.js CLI, OpenTUI (React) TUI, Zod, `bun:test`, `bun:sqlite` (glossary + context), JSONC config at `~/.config/tl/config.jsonc`.

```
packages/shared/     # types, errors, constants, utils
packages/core/       # config, glossary, pipeline, context, session, files/
packages/adapters/   # TranslateGemma (Ollama), mock
apps/cli/            # `tl` command
apps/tui/            # interactive terminal UI
```

## Packages, versioning & releases

- Only `packages/npm-tl` (the `tl` wrapper) and its per-platform binary packages `packages/npm-tl-*` are published. `@translate-local/shared`, `core` and `adapters` are `"private": true` and bundled into the binary. The apps are private too.
- `shared`, `core` and `adapters` have **no build step**. Each subpath export points at a plain `./src/….ts` file, which Bun and `tsc` both read directly. Keep it that way: a `dist` condition would make typecheck depend on a build. In `turbo.json`, `test` and `typecheck` depend on the no-op `transit` task, not on `^build`.
- `core` and `adapters` peer-depend on `shared`, and `core` peer-depends on `adapters`.
- Versioning is unified: every `package.json` shares one version. Feature and fix PRs leave versions and `CHANGELOG.md` alone. A release PR (`chore(release): prepare X.Y.Z`) bumps every `package.json`, refreshes `bun.lock` and adds the root `CHANGELOG.md` entry (`## [X.Y.Z] - YYYY-MM-DD` with Added/Changed/Fixed/Removed). The `vX.Y.Z` tag is pushed after it merges. See CONTRIBUTING.md.

## Key patterns

**Read the matching internals doc before changing these areas.** Each holds the rules and the bench measurements behind them:

- `docs/internals/pipeline.md`: pipeline, Term Set, glossary retries and code-switching, tag strip, agreement fix-ups and repair, tag check, prompt builders, streaming, image mode
- `docs/internals/file-mode.md`: `packages/core/src/files/` (sentinels, ICU, sync, locks, prune, abort, locale roots, i18next plurals)
- `docs/internals/glossary.md`: glossary matching, lookup fallback, term forms
- `docs/context-guide.md`: context tokenizer, scoring, index layout
- `docs/adr/`: decisions that look wrong but aren't

Rules that apply everywhere:

- **Adapters** implement `translate()` and `dispose()`. Build them with `createAdapter(toAdapterConfig(coreConfig, backend?))`. `translate()` returns only `AdapterResponse` (`translated` + `metadata: { adapter, durationMs }`). The pipeline builds `TranslationResult`, so keep pipeline-owned fields out of the adapter's return type.
- **Frontends use `TranslationSession`** (`@translate-local/core/session`). It is never wired by hand from an adapter and stores. It resolves the backend from `TL_ADAPTER`, owns the adapter and the stores, and runs context retrieval + `runPipeline`. File mode passes `session.adapter`/`glossaryStore`/`contextStore` to `translateFile`. `dispose()` is idempotent and unloads the model only if a request was sent.
- **Config defaults** live in `@translate-local/shared/constants`. `configSchema` consumes them via `.default()`/`.prefault({})`; never restate a default literal. `${VAR}` substitution always yields a string. Number fields convert through `envNumber()`, so the field's type drives coercion, not the string's shape.
- **Errors** are `TaggedError`s with a `tag` + actionable `hint`. Tags live in `packages/shared/src/errors.ts`.
- **Glossary tags** use TranslateGemma's format, `<term translation="target">source</term>`. Keep it unchanged.
- **Cancellation**: an `AbortSignal` flows through `TranslationRequest.signal`/`PipelineOptions.signal` to every attempt. A caller abort always surfaces as `cancelledError()` (tag `CANCELLED`), never as a timeout or `TRANSLATION_FAILED`, and no fallback may absorb it.
- **Memory**: the CLI disposes after each translation. On the first SIGINT/SIGTERM it aborts so `finally` still disposes, then exits 130/143 (`exitOnInterrupt()` in `apps/cli/src/utils/run.ts`). The TUI destroys the renderer before waiting (≤ 3 s) on the unload. File mode disposes once per file, not per leaf.
- **Images**: both frontends read them with `readImageBase64(path)` from `@translate-local/core/session`. It checks the extension and size (≤ 10 MB) against constants in `shared` and throws the typed `IMAGE_*` errors. Don't re-implement those checks.
- **Context** (`packages/core/src/context.ts`): filter only through `retrieve(query, maxSnippets, minRelevance)`, never in the apps. Bump `CONTEXT_INDEX_VERSION` whenever `tokenize()` output or stored weights change. Keep retrieval a primary-key seek (an EXPLAIN QUERY PLAN test checks this).
- **MockAdapter** (`createMockAdapter()`): deterministic glossary substitution for tests. `{ ignoreGlossary: true }` or `TL_MOCK_IGNORE_GLOSSARY=1` (for CLI spawn tests) forces a glossary miss. A `repairTerms` request returns `source` unchanged.
- **CLI commands**: wrap actions in `runAction(fn, { json: opts.json })` and open stores with `withStore()` (`apps/cli/src/utils/run.ts`). JSON errors print `{ error, message, hint }`, and consumers parse those keys. Set `process.exitCode`, not `process.exit()`. Bulk glossary inserts go through `GlossaryStore.addMany()`. Show glossary coverage only when `result.glossaryTerms > 0`.
- **RTL**: use `isRtlLang()`/`hasRtlChars()`/`RTL_LANGS` from `@translate-local/shared/utils/language`.

## Testing

- `bun run test` runs everything offline: pipeline, SQLite, MockAdapter. `TEST_ADAPTER=1` adds the real Ollama tests.
- **Pipeline/postprocess and file-mode changes**: run `bun run scripts/bench/replay.ts --out /tmp/before.json` on `main`, then `--diff /tmp/before.json` on the branch. It replays every saved run on the JSON fixture and two YAML copies (comments, block scalars, i18next plurals; Rails `en:` root) and compares every line written, so formatting changes show too. A refactor must show 0 differences, and a behaviour change lists exactly the leaves it touches. This only works where runs were saved in the gitignored `scripts/bench/results/`.
- **Prompt/glossary/placeholder changes**: compare success rates (not single outputs) from `bun run scripts/bench/strict-glossary.ts --runs 10` before and after. For file-mode cost, use `bun run scripts/bench/file-mode.ts`. For agreement, use `scripts/bench/agreement.ts`.
- **CLI tests** spawn the binary and assert stdout and exit codes. Keep `--timeout 30000` in `apps/cli`'s test script, because Windows cold starts are slow.
- **CI** runs on Linux, macOS and Windows. `ci-ok` is the only required check, so add new jobs to its `needs`. The compile flags `--compile --minify --sourcemap --bytecode --format=esm` must match across `ci.yml`, `release.yml` and `apps/cli`'s `build` script. On Windows, set `USERPROFILE` wherever a test overrides `HOME`, build paths with `join()`, and use `db.query()` rather than unfinalized `db.prepare()` (open statements cause EBUSY on delete).

## Before every commit

Run all of these in order. If one fails, fix it and re-run all of them.

1. `bun run build`
2. `bun run test`, with 0 failures
3. A smoke test of the `tl` commands the change touches
4. `TEST_ADAPTER=1 bun run test` if Ollama-facing adapter code changed

## How to work

- State assumptions, and ask when a request has more than one reading. Push back when a simpler approach exists.
- Write the minimum code for the request, with no speculative options or abstractions. Every changed line should trace to the request. Mention unrelated dead code rather than deleting it, and remove only what your own change orphaned.
- For a fix, write a failing test first. For a refactor, tests pass before and after.
- When a change adds or alters a pattern above, update this file or the matching internals doc in the same PR.

## Reference docs

`docs/cli-reference.md` (commands and flags), `docs/glossary-guide.md`, `docs/file-translate-guide.md`, `docs/context-guide.md`, `docs/tui-guide.md`, `docs/adapter-development.md`.
