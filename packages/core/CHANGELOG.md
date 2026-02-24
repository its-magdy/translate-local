# Changelog

## [0.2.0] - 2026-02-24

### Added
- `config.ts`: Zod schema (`configSchema`) for `~/.config/tl/config.jsonc`; `loadConfig` with JSONC comment stripping, `~` expansion, `${ENV}` resolution; `saveConfig`
- `glossary.ts`: `GlossaryStore` (SQLite CRUD via `bun:sqlite`); `matchTerms` with word-boundary, longest-first greedy matching
- `pipeline.ts`: `runPipeline` orchestrator — preprocess (glossary tag injection), translate, postprocess (tag strip + normalize), validate (coverage check + strict retry loop)
- Unit tests for config schema, config loader, glossary matcher, glossary store
- Integration tests (`TEST_INTEGRATION=1`) for full pipeline with mock adapter and SQLite

## [0.1.0] - 2026-02-10

### Added
- Initial package scaffold with placeholder exports
