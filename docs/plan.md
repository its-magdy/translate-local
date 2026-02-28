# `tl` — Translation CLI Tool Implementation Plan

## Context

Build an open-source translation CLI/TUI tool using TranslateGemma as the default model, with a pluggable adapter system for future LLMs (Ollama, API-based). The project has detailed planning docs already at `docs/` — this plan builds on them.

**Name**: `tl` (CLI command), `@tl/*` (packages)

## Architecture

Bun + Turborepo + TypeScript monorepo (as specified in `docs/implementation-plan.md`):

```
t/
├── packages/shared/     # Types, errors, constants, utils
├── packages/core/       # Config, glossary, pipeline, context
├── packages/adapters/   # TranslateGemma (local), mock, future LLMs
├── apps/cli/            # Commander.js CLI (`tl` command)
└── apps/tui/            # Interactive terminal UI
```

## Key Design Decisions

### 1. Adapter Interface — `dispose()` for Memory Management
Every adapter implements `dispose()`. For Ollama local: sends `keep_alive: 0` to unload model from VRAM. Pipeline calls `dispose()` after each translation when `config.adapter.local.keepAlive: false` (default). TUI registers SIGINT/SIGTERM handlers to call `dispose()` on exit.

### 2. TranslateGemma vs Generic LLMs
TranslateGemma uses structured prompts with `source_lang_code`/`target_lang_code` + XML glossary tags. Generic LLMs use natural language prompts. Each adapter handles its own prompt format — the pipeline is format-agnostic.

### 3. Glossary XML Tags
Format: `<term translation="واجهة برمجة">API</term>` (TranslateGemma's recommended approach). Postprocess strips any tags the model echoes back.

## Implementation Phases

### Phase 1: Foundation
- Root monorepo: `package.json`, `turbo.json`, `tsconfig.base.json`
- `packages/shared/src/types/` — adapter, translation, glossary, context, config interfaces
- `packages/shared/src/errors.ts` — `TlError` with tags + hints
- `packages/shared/src/constants.ts` — 55 supported languages, default paths
- `packages/shared/src/utils/language.ts` — BCP-47 normalization
- `packages/shared/src/utils/text.ts` — tag injection/stripping, whitespace normalization
- Tests: text utils, language utils

### Phase 2: Adapters
- `packages/adapters/src/mock.ts` — deterministic mock for tests
- `packages/adapters/src/base.ts` — shared prompt builders (structured + natural)
- `packages/adapters/src/factory.ts` — `createAdapter(config)`
- `packages/adapters/src/translate-gemma/local.ts` — Ollama HTTP API, `dispose()` unloads model
- Tests: mock, factory, prompt format; gated: real Ollama calls

### Phase 3: Core Pipeline
- `packages/core/src/config/schema.ts` — Zod schema for config.jsonc
- `packages/core/src/config/manager.ts` — load/save JSONC, `~` expansion, env var resolution
- `packages/core/src/glossary/store.ts` — SQLite CRUD via `bun:sqlite`
- `packages/core/src/glossary/matcher.ts` — word-boundary matching, longest-first greedy
- `packages/core/src/pipeline/` — preprocess (tag inject), postprocess (tag strip), validate (glossary coverage), pipeline (orchestrator with retry loop)
- Tests: matcher, pre/postprocess, validation, full pipeline integration with mock adapter

### Phase 4: CLI
- `apps/cli/src/commands/translate.ts` — `tl "text" --from en --to ar --glossary strict --json`
- `apps/cli/src/commands/glossary.ts` — add/list/remove/import/export
- `apps/cli/src/commands/context.ts` — add/list/remove/index
- `apps/cli/src/commands/config.ts` — connect (set adapter via flags), status (health check), path
- `apps/cli/src/formatters/output.ts` — plain/table/JSON formatters, ANSI colors (TTY-aware)
- `apps/cli/src/index.ts` — Commander program entry, bin: `tl` (no args → launches TUI)
- Tests: spawn binary, assert stdout/exit codes

### Phase 5: Context System
- `packages/core/src/context/indexer.ts` — TF-IDF in SQLite, indexes .txt/.md/.mdx/.rst files
- `packages/core/src/context/provider.ts` — add/remove/index/retrieve
- Tests: index temp dir, retrieve relevant snippets

### Phase 6: TUI
- `apps/tui/src/views/translate.ts` — side-by-side source/target, language selector dropdown
- `apps/tui/src/views/glossary.ts` — table view with CRUD
- `apps/tui/src/index.ts` — cleanup handlers (dispose adapter on exit)

### Phase 7: Documentation
- `README.md` — quickstart (install, configure, translate in 3 commands)
- `docs/cli-reference.md` — all commands, flags, exit codes, env vars
- `docs/adapter-development.md` — guide for adding new adapters
- `docs/glossary-guide.md` — usage, CSV format, strict vs prefer
- `docs/context-guide.md` — what it does, supported file types
- `CONTRIBUTING.md` — dev setup, testing, PR requirements

## Key Files to Modify/Create

All new files — project is currently in planning phase only. Critical reference docs:
- `docs/implementation-plan.md` — architecture blueprint
- `docs/product-spec.md` — data models and CLI commands spec
- `docs/translategemma-research.md` — prompt format and API details
- `docs/better-context-analysis.md` — TaggedError pattern, config system reference

## Verification

Per phase:
1. `bun install && bun run build` — builds clean
2. `bun run test` — unit tests pass
3. `TEST_INTEGRATION=1 bun run test` — pipeline integration tests pass
4. `tl "Hello world" --to ar` with mock adapter — deterministic result
5. `tl glossary add --source API --target "واجهة برمجة" --from en --to ar` then `tl "The API" --to ar --glossary strict` — glossary enforced
6. With Ollama running: `tl config connect --adapter translate-gemma --backend local` then real translation, verify model unloads after

End-to-end: `tl config status` shows OK, `tl "text" --to ar` translates, `tl glossary list` shows entries, model memory freed after use.
