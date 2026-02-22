# Changelog

All notable changes to `@tl/shared` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-02-23

### Fixed

- `normalizeLang`: now trims surrounding whitespace before lowercasing, so CLI input like `" EN "` resolves correctly
- `stripGlossaryTags`: regex now uses the `s` (dotAll) flag so tags wrapping multiline content are stripped correctly

## [0.1.0] - 2026-02-22

### Added

- `types.ts` — core types: `TranslationRequest`, `TranslationResult`, `Adapter`, `GlossaryEntry`, `GlossaryHit`, `ContextSource`, `ContextSnippet`, `AdapterConfig`, `TlConfig`
- `errors.ts` — `TlError` class with `tag` and `hint` fields for actionable error messages
- `constants.ts` — `SUPPORTED_LANGUAGES` (50 BCP-47 base codes from WMT24++ benchmark), `DEFAULT_MODEL`, `DEFAULT_OLLAMA_URL`, default paths
- `utils/language.ts` — `normalizeLang()`, `isSupported()` for BCP-47 validation; `isSupported` accepts regional subtags (e.g. `"zh-CN"`) by falling back to the base code
- `utils/text.ts` — `injectGlossaryTags()` (XML-attribute-escapes `targetTerm`, throws on out-of-order/overlapping hits), `stripGlossaryTags()`, `normalizeWhitespace()`
- Unit tests for language and text utils (17 tests, all passing)
