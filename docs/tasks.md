# `tl` — Development Tasks

## Phase 1: Foundation
- [x] Initialize root monorepo (`package.json`, `turbo.json`, `tsconfig.base.json`)
- [x] Create `packages/shared/` with package.json and tsconfig
- [ ] Implement shared types: `adapter.ts`, `translation.ts`, `glossary.ts`, `context.ts`, `config.ts`
- [ ] Implement `errors.ts` — `TlError` with tagged errors and hints
- [ ] Implement `constants.ts` — supported languages (55), default paths, default model
- [ ] Implement `utils/language.ts` — BCP-47 normalization, validation
- [ ] Implement `utils/text.ts` — glossary tag injection/stripping, whitespace normalization
- [ ] Write tests for text utils and language utils
- [ ] Verify: `bun install && bun run build` succeeds

## Phase 2: Adapters
- [x] Create `packages/adapters/` with package.json and tsconfig
- [ ] Implement `base.ts` — abstract base with prompt builders (structured + natural)
- [ ] Implement `mock.ts` — deterministic mock adapter
- [ ] Implement `factory.ts` — `createAdapter(config)`
- [ ] Implement `translate-gemma/local.ts` — Ollama HTTP API + `dispose()` for memory cleanup
- [ ] Implement `translate-gemma/huggingface.ts` — HF Inference API with token resolution
- [ ] Write tests: mock, factory, prompt format
- [ ] Write gated tests (`TEST_ADAPTER=1`): real Ollama and HF calls

## Phase 3: Core Pipeline
- [x] Create `packages/core/` with package.json and tsconfig
- [ ] Implement `config/schema.ts` — Zod schema for config.jsonc
- [ ] Implement `config/manager.ts` — load/save JSONC, `~` expansion, env var resolution
- [ ] Implement `glossary/store.ts` — SQLite CRUD via `bun:sqlite`
- [ ] Implement `glossary/matcher.ts` — word-boundary matching, longest-first greedy
- [ ] Implement `pipeline/preprocess.ts` — glossary detection + tag injection
- [ ] Implement `pipeline/postprocess.ts` — tag stripping + normalization
- [ ] Implement `pipeline/validate.ts` — glossary coverage check + retry decision
- [ ] Implement `pipeline/pipeline.ts` — orchestrator with retry loop and dispose
- [ ] Write tests: matcher, pre/postprocess, validation
- [ ] Write integration tests (`TEST_INTEGRATION=1`): full pipeline with mock adapter + SQLite

## Phase 4: CLI
- [x] Create `apps/cli/` with package.json and tsconfig
- [ ] Implement `commands/translate.ts` — main translate command with `--from`, `--to`, `--glossary`, `--json`
- [ ] Implement `commands/glossary.ts` — add/list/remove/import/export subcommands
- [ ] Implement `commands/context.ts` — add/list/remove/index subcommands
- [ ] Implement `commands/config.ts` — connect (set adapter via flags), status (health check), path
- [ ] Implement `formatters/output.ts` — plain/table/JSON formatters, ANSI colors
- [ ] Implement `index.ts` — Commander program entry, bin: `tl`
- [ ] Write CLI tests: spawn binary, assert stdout/exit codes

## Phase 5: Context System
- [ ] Implement `context/indexer.ts` — TF-IDF in SQLite, file walking, tokenization
- [ ] Implement `context/provider.ts` — add/remove/index/retrieve wrapper
- [ ] Write tests: index temp directory, retrieve relevant snippets

## Phase 6: TUI
- [x] Create `apps/tui/` with package.json and tsconfig
- [ ] Implement translate view — side-by-side source/target with language selector
- [ ] Implement glossary view — table with CRUD operations
- [ ] Implement compare view — multi-model parallel comparison
- [ ] Implement entry point with cleanup handlers (dispose adapter on SIGINT/SIGTERM)

## Phase 7: Documentation
- [ ] Write `README.md` — quickstart, features, installation
- [ ] Write `docs/cli-reference.md` — all commands, flags, exit codes, env vars
- [ ] Write `docs/adapter-development.md` — guide for adding new adapters
- [ ] Write `docs/glossary-guide.md` — usage, CSV format, strict vs prefer
- [ ] Write `docs/context-guide.md` — what it does, supported file types
- [ ] Write `CONTRIBUTING.md` — dev setup, testing, PR requirements
