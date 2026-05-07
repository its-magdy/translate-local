# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-05-06

### Added
- **File mode** for `tl translate`: `--file <path>` translates JSON or YAML i18n catalogs.
  - Default sync semantics: only translates missing, empty, `null`, or whitespace-only target values; existing translations are preserved. Pass `--force` to re-translate everything.
  - Output path auto-inferred via locale-token replacement (`en.json` → `ar.json`, `messages.en.yaml` → `messages.ar.yaml`, `locales/en/common.json` → `locales/ar/common.json`). Override with `--out <path>`.
  - Atomic write — temp file + rename — guarantees the original target is intact on crash or kill.
  - Re-parse-before-commit: the written file is re-read to confirm it parses cleanly; on failure the rename is skipped.
  - Round-trip preserves: indentation, line endings (LF/CRLF), trailing newline, key order, UTF-8 BOM stripping. YAML additionally preserves comments, block scalar style (`|`/`>`), and quoting style.
  - Placeholder protection (hybrid mask + multiset validation) for: `{{name}}` (i18next), `{name}` (Vue/ICU simple), `%{name}` (Rails), `%s`/`%d`/`%1$s` (printf), `$t(...)` (i18next nesting), `@:linked` (Vue), HTML tags.
  - Non-translatable skip heuristics for URLs, emails, semver, single chars, and ALL-CAPS short tokens. Override with `--translate-all`.
  - `--dry-run` reports what would be translated without writing.
  - On validation failure (e.g. placeholder mismatch) the default behavior is to record the key in the failed list, fall back to the source value, and continue the run. Pass `--strict` to abort on the first failure instead.
  - `--format auto|json|yaml|raw-json|raw-yaml`: format override; `raw-*` bypasses content-shape refusal.
  - `--max-size <mb>` controls source file size cap (default 20 MB).
  - Refused-by-default formats: Flutter ARB (`@key` metadata + ICU), Apple `.xcstrings`, FormatJS-with-ICU, Lingui full mode, YAML with anchors/aliases, YAML 1.1 directive, multi-document YAML.
  - 7 new typed errors: `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `FILE_PARSE_FAILED`, `FILE_WRITE_FAILED`, `FILE_INVALID_FORMAT`, `PLACEHOLDER_MISMATCH`, `SAME_LOCALE`.
  - New core subpath export: `@translate-local/core/files`.
- New docs: [`docs/file-translate-guide.md`](docs/file-translate-guide.md).

### Changed
- `yaml@^2` added as a dependency of `@translate-local/core`.
- `DEFAULT_MODEL` constant updated from `translate-gemma-12b` to `translategemma:latest` to match the model name in current Ollama registry. This unblocks `TEST_ADAPTER=1` gated tests (was failing for all users since the old tag was retired).
- Prompt builder now appends explicit placeholder-preservation instructions and few-shot examples when the source contains `__TLPH_N__` sentinels (file mode). Combined with synthetic glossary hits and 10-attempt retries, this brings multi-placeholder preservation from ~30-60% to >99% across every tested family.

## [0.3.5] - 2026-05-02

### Changed
- Bump Bun from 1.3.5 to 1.3.13 (release CI pinned to 1.3.13)
- Bump `@opentui/core` from 0.1.82 to 0.2.1
- Upgrade TypeScript from 5.7 to 6.0; replace `bun-types` with `@types/bun`

## [0.3.4] - 2026-04-11

### Fixed
- Pin Bun to 1.3.5 in release CI — Bun 1.3.12 regresses macOS codesigning,
  producing binaries that `codesign -s -` rejects with "invalid or unsupported format"

## [0.3.3] - 2026-04-11

### Fixed
- Remove `--sourcemap` from release binary builds — sourcemaps embedded in the Mach-O binary prevent `codesign` from signing on macOS 15 (Sequoia) runners

## [0.3.2] - 2026-04-11

### Added
- `install.sh`: curl-pipe installer for macOS and Linux — auto-detects platform, downloads binary from GitHub Releases, installs to `~/.local/bin`, patches shell rc files for PATH

### Fixed
- macOS Gatekeeper killing compiled binaries (exit 137) on Apple Silicon / macOS 15+: darwin binaries are now ad-hoc codesigned in CI using Bun's required JIT entitlements before upload

## [0.3.1] - 2026-04-11

### Fixed
- Lowercase GitHub repository URLs across all package.json files (`Translate-Local` → `translate-local`)
- Replace `npm install` / `npx` with `bun install` / `bunx` in READMEs
- Add keywords to `@translate-local/tl` npm package

## [0.3.0] - 2026-04-10

### Changed
- Unified versioning: all packages now share a single version number, bumped together on each release

### Added
- Standalone binary distribution via `bun build --compile` (CLI)
- `.github/workflows/release.yml`: cross-compiles `tl` for darwin-arm64, darwin-x64, linux-x64, linux-arm64, and windows-x64 on `v*` tag push
- npm distribution via `@translate-local/tl` with platform-specific optional dependencies
- TUI embedded in-process via dynamic `import()` (no subprocess spawn)
- `ContextStore`: SQLite-backed TF-IDF context retrieval with add, remove, list, reindex, retrieve (core)
- Config loader with JSONC comment stripping, `~` expansion, `${ENV}` resolution (core)
- `GlossaryStore`: SQLite CRUD with word-boundary, longest-first greedy matching (core)
- `runPipeline` orchestrator: preprocess, translate, postprocess, validate with strict retry loop (core)
- `TranslateGemmaLocalAdapter`: Ollama HTTP API adapter with `dispose()` for VRAM unloading (adapters)
- `MockAdapter`: deterministic adapter for tests with glossary substitution (adapters)
- `buildStructuredPrompt()` and `buildNaturalPrompt()` prompt builders (adapters)
- `createAdapter(config)` factory (adapters)
- Shared types, `TlError` with tag+hint, `SUPPORTED_LANGUAGES`, language/text utils (shared)
- Image translation support via `--image` flag
- Streaming output support via `onChunk` callback
- JSON output mode via `--json` flag
- Interactive terminal UI (TUI) with Translate and Glossary tabs
- Glossary management CLI: add, list, remove, import, export
- Context source management CLI: add, list, remove, index

### Removed
- `TranslateGemmaHFAdapter`: HuggingFace backend removed (not available on HF serverless API)

### Fixed
- `normalizeLang`: trims whitespace before lowercasing (shared)
- `stripGlossaryTags`: regex uses `s` (dotAll) flag for multiline content (shared)

## [0.1.0] - 2026-03-30

### Added
- Initial release: CLI-first translation tool with TranslateGemma via Ollama
