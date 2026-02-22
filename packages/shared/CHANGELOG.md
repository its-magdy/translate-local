# Changelog

All notable changes to `@tl/shared` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-22

### Added

- `types.ts` — core types: `TranslationRequest`, `TranslationResult`, `Adapter`, `GlossaryEntry`, `GlossaryHit`, `ContextSource`, `ContextSnippet`, `AdapterConfig`, `TlConfig`
- `errors.ts` — `TlError` class with `tag` and `hint` fields for actionable error messages
- `constants.ts` — `SUPPORTED_LANGUAGES` (55 BCP-47 codes), `DEFAULT_MODEL`, `DEFAULT_OLLAMA_URL`, default paths
- `utils/language.ts` — `normalizeLang()`, `isSupported()` for BCP-47 validation
- `utils/text.ts` — `injectGlossaryTags()`, `stripGlossaryTags()`, `normalizeWhitespace()`
- Unit tests for language and text utils (14 tests, all passing)
