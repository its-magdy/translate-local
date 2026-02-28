# Changelog — @tl/adapters

## [0.2.0] - 2026-02-28

### Removed
- `TranslateGemmaHFAdapter` — HuggingFace backend removed (TranslateGemma is not available on HF serverless inference API)
- `huggingface` backend option from `AdapterConfig` and `createAdapter` factory
- Subpath export `./translate-gemma/huggingface`

## [0.1.1] - 2026-02-23

### Added
- `MockAdapter` — deterministic adapter for tests; substitutes glossary terms, reports coverage
- `TranslateGemmaLocalAdapter` — Ollama HTTP API adapter with `dispose()` for VRAM unloading
- `TranslateGemmaHFAdapter` — HuggingFace Inference API adapter with `${ENV_VAR}` token resolution
- `createAdapter(config)` factory — constructs the right adapter from `AdapterConfig`
- `createMockAdapter()` convenience factory
- `buildStructuredPrompt()` — TranslateGemma-style prompt with XML glossary tags and context snippets
- `buildNaturalPrompt()` — natural language prompt for generic LLMs
- Subpath exports: `./factory`, `./base`, `./translate-gemma/local`, `./translate-gemma/huggingface`
- Unit tests for mock, factory, and prompt builders (38 passing)
- Gated tests for real Ollama and HuggingFace calls (`TEST_ADAPTER=1`)

## [0.1.0] - 2026-02-22

### Added
- Initial package scaffold (placeholder `mock.ts`)
