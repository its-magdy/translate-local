# `tl` — Development Tasks

## Phase 1: Foundation
- [x] Initialize root monorepo (`package.json`, `turbo.json`, `tsconfig.base.json`)
- [x] Create `packages/shared/` with package.json and tsconfig
- [x] Implement shared types: `adapter.ts`, `translation.ts`, `glossary.ts`, `context.ts`, `config.ts`
- [x] Implement `errors.ts` — `TlError` with tagged errors and hints
- [x] Implement `constants.ts` — supported languages (55), default paths, default model
- [x] Implement `utils/language.ts` — BCP-47 normalization, validation
- [x] Implement `utils/text.ts` — glossary tag injection/stripping, whitespace normalization
- [x] Write tests for text utils and language utils
- [x] Verify: `bun install && bun run build` succeeds

## Phase 2: Adapters
- [x] Create `packages/adapters/` with package.json and tsconfig
- [x] Implement `base.ts` — abstract base with prompt builders (structured + natural)
- [x] Implement `mock.ts` — deterministic mock adapter
- [x] Implement `factory.ts` — `createAdapter(config)`
- [x] Implement `translate-gemma/local.ts` — Ollama HTTP API + `dispose()` for memory cleanup
- [x] Write tests: mock, factory, prompt format
- [x] Write gated tests (`TEST_ADAPTER=1`): real Ollama calls

## Phase 3: Core Pipeline
- [x] Create `packages/core/` with package.json and tsconfig
- [x] Implement `config.ts` — Zod schema, load/save JSONC, `~` expansion, env var resolution
- [x] Implement `glossary.ts` — SQLite CRUD via `bun:sqlite`, word-boundary matcher (longest-first greedy)
- [x] Implement `pipeline.ts` — preprocess (tag inject), postprocess (tag strip + normalize), validate (coverage + retry), orchestrator
- [x] Write tests: matcher, glossary store, config, pipeline (unit)
- [x] Write integration tests (`TEST_INTEGRATION=1`): full pipeline with mock adapter + SQLite

## Phase 4: CLI
- [x] Create `apps/cli/` with package.json and tsconfig
- [x] Implement `commands/translate.ts` — main translate command with `--from`, `--to`, `--glossary`, `--json`
- [x] Implement `commands/glossary.ts` — add/list/remove/import/export subcommands
- [x] Implement `commands/context.ts` — add/list/remove/index subcommands
- [x] Implement `commands/config.ts` — connect (set adapter via flags), status (health check), path
- [x] Implement `formatters/output.ts` — plain/table/JSON formatters, ANSI colors
- [x] Implement `index.ts` — Commander program entry, bin: `tl`
- [x] Write CLI tests: spawn binary, assert stdout/exit codes

## Phase 5: Context System
- [x] Implement `context.ts` — `ContextStore` with SQLite-backed TF-IDF indexing, file walking (.txt/.md/.mdx/.rst), tokenization
- [x] Implement CLI `commands/context.ts` — add/list/remove/index subcommands (replaces Phase 4 stubs)
- [x] Write tests: index temp directory, retrieve relevant snippets, error handling (`TEST_INTEGRATION=1`)

## Phase 6: TUI
- [x] Create `apps/tui/` with package.json and tsconfig
- [x] Implement translate view — side-by-side source/target with language selector
- [x] Implement glossary view — table with CRUD operations
- [-] ~~Implement compare view~~ — removed; no real value until a second real adapter is available
- [x] Implement entry point with cleanup handlers (dispose adapter on SIGINT/SIGTERM)

## Phase 7: Documentation
- [x] Write `README.md` — quickstart, features, installation
- [x] Write `docs/cli-reference.md` — all commands, flags, exit codes, env vars
- [x] Write `docs/adapter-development.md` — guide for adding new adapters
- [x] Write `docs/glossary-guide.md` — usage, CSV format, strict vs prefer
- [x] Write `docs/context-guide.md` — what it does, supported file types
- [x] Write `CONTRIBUTING.md` — dev setup, testing, PR requirements
