# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.2] - 2026-07-12

### Fixed
- **Empty or comments-only source YAML no longer wipes the target file.** A source document with no content nodes made the write path a silent no-op and replaced the existing target with an empty document, deleting every key. The target data is now materialized into the output.
- **YAML shape mismatches no longer drop target data.** A key present in both files but with different shapes (e.g. source scalar vs target plural map, or an empty `key:`) was silently dropped on sync; the node is now replaced wholesale so the target's structure survives.
- **Piped stdout is now truly pipe-safe.** Tokens stream to stdout only when it is an interactive terminal; piped output receives exactly the final postprocessed translation once. Previously a pipe could capture raw glossary `<term>` tags, unnormalized whitespace, or — with strict-mode retries — two concatenated translations. When streaming, the final text is reprinted whenever it differs from what was streamed.
- **Typed env substitution for config values.** A quoted `"${VAR}"` on a number or boolean field now converts to that type — `"maxRetries": "${TL_RETRIES}"` with `TL_RETRIES=3` loads as the number `3` — and the parse error for an unquoted `${VAR}` explains that the reference must be inside a quoted string. Conversion is driven by the field's declared type, not by the env value's shape, so a numeric-looking value on a string field (`"model": "${TL_MODEL}"` with `TL_MODEL=2`) stays a string instead of failing with `CONFIG_INVALID`.
- **File mode no longer overwrites the source file.** The same-locale guard only fired when `--from` was given explicitly, so `tl translate --file en.json --to en` (source language left at `auto`) resolved the output path back onto the input and rewrote it — with `--force` it would have replaced the source with its own translation. The source and output paths are now compared directly and the run is refused with `SAME_LOCALE`. An `--out` that resolves to the source path is refused the same way.
- **YAML block scalar chomping indicators survive translation.** A translated value comes back without a trailing newline, which silently rewrote `|` as `|-`, `>` as `>-`, and `|+` as `|-` — the last dropping the trailing blank lines the `+` indicator exists to keep. The original trailing-newline run is now carried onto the translated value.
- **`tl help` prints usage** instead of translating the literal word "help". Root-level flags are now derived from the program's registered options instead of a hardcoded list.
- **Metadata color now follows stderr.** ANSI codes for the metadata block gate on stderr's TTY-ness, so `2> err.log` no longer captures raw escape bytes and metadata stays colored when stdout is piped. Metadata indentation is also consistent between color and NO_COLOR runs.
- **YAML file mode no longer deletes target-only keys.** `writeYaml` re-serializes the source document; keys present only in the existing target file (e.g. entries kept after the source dropped them) were silently removed on every sync. They are now appended to the output. Extra array elements in the target survive the same way. The JSON path was unaffected.
- **Empty glossary terms can no longer hang translations.** An empty `sourceTerm` produced a zero-width regex that spun `matchTerms` forever on any text containing punctuation or digits. `matchTerms` now skips empty terms and iterates with `matchAll`, and `GlossaryStore.add` rejects empty/whitespace terms with `INVALID_INPUT`.
- **Non-streaming adapters now print the translation.** Non-JSON CLI output relied entirely on streaming; adapters that don't stream produced metadata with no translation text. The final translation is now printed when nothing was streamed, and after strict-mode retries the corrected final text is printed as well.
- **Translation metadata moved from stdout to stderr.** `tl "text" --to fr > out.txt` no longer captures adapter/timing/glossary-coverage lines; stdout carries only the translation.
- **Flag-first invocation works:** `tl --to fr "hello"` now routes to `translate` instead of failing with `unknown option`.
- **Config env vars with backslashes or quotes no longer break parsing.** `${VAR}` substitution now happens on parsed string values instead of the raw JSON text, so Windows paths and quoted values round-trip intact.

### Removed
- `resolveConfigPath()`, `resolveGlossaryDbPath()`, and `resolveContextDbPath()` from `@translate-local/shared/constants`, and the unused `TlConfig` interface from `@translate-local/shared/types`. `loadConfig` now expands `~` in the `DEFAULT_*_PATH` constants itself, so the resolvers had no remaining callers; external code should read the resolved paths off the loaded config instead. Permitted under a patch bump only because the scope is pre-1.0 and unpublished — see [semver clause 4](https://semver.org/#spec-item-4).

### Changed
- Removed stale `TEST_INTEGRATION` references from docs, `turbo.json`, and CI — the pipeline and context test suites now run in the default `bun run test` (they use MockAdapter and temp SQLite only); no code has read the variable since. `TEST_ADAPTER=1` (real Ollama) remains.

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
- `tl languages` command: lists supported language codes and names.

### Changed
- `yaml@^2` added as a dependency of `@translate-local/core`.
- `DEFAULT_MODEL` constant updated from `translate-gemma-12b` to `translategemma:latest` to match the model name in current Ollama registry. This unblocks `TEST_ADAPTER=1` gated tests (was failing for all users since the old tag was retired).
- Prompt builder now appends explicit placeholder-preservation instructions and few-shot examples when the source contains `__TLPH_N__` sentinels (file mode). Combined with synthetic glossary hits and 10-attempt retries, this brings multi-placeholder preservation from ~30-60% to >99% across every tested family.

### Fixed
- Glossary `add` lang pickers now read defaults from config instead of hardcoding `en`/`fr`.
- Ollama HTTP fetch calls now use `AbortSignal` timeouts so requests don't hang forever when the daemon is unreachable.

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
