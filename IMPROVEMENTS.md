# tl — Improvement Roadmap

Comprehensive list of bugs, missing features, UX problems, test gaps, and competitive opportunities.
Generated from full codebase review + competitive research (May 2026).

---

## 🔴 Critical Bugs (will cause real failures today)

**1. ~~No timeout on Ollama API calls~~** ✅ Already fixed
- Verified `AbortSignal.timeout(this.timeoutMs)` at `packages/adapters/src/translate-gemma/local.ts:50` (Phase A research, 2026-05-06).

**2. Image translation is broken**
- Files: `apps/cli/src/commands/translate.ts:92-93`, `apps/tui/src/views/translate.ts:267-268`
- The feature passes raw Base64 to TranslateGemma, which is a text-only model. There is no OCR step to extract text first. The feature is documented and shipped but does not work.
- Fix: add an OCR pass (e.g. Tesseract) before handing off to the adapter, or clearly document the limitation.

**3. TUI silently swallows DB errors**
- File: `apps/tui/src/views/glossary.ts:128-130`
- DB exceptions are caught and replaced with an empty list. Users see an empty glossary when the DB is corrupted, with no error message.
- Fix: surface the error in the TUI status bar instead of silently returning `[]`.

**4. Glossary coverage reporting is misleading**
- File: `apps/cli/src/formatters/output.ts:23-26`
- When the glossary is empty (no hits), the tool reports "100% covered ✓". Looks like success when nothing was enforced.
- Fix: show "no glossary terms found" instead of a coverage percentage when hit count is 0.

---

## 🟠 High Impact — Missing Features

**5. No cloud model adapters**
- Only Ollama/TranslateGemma is supported. Users without a local GPU cannot use the tool.
- Competitors (Lokalise, Crowdin, attranslate) all support DeepL, OpenAI, Google Translate, Azure.
- Recommendation: add adapters for OpenAI and Anthropic behind `--model openai` / `--model anthropic`, reading API keys from env or config.

**6. ~~No file format translation~~** ✅ Shipped in v0.4.0
- `tl translate --file <path>` supports JSON (vanilla flat/nested, i18next-plurals, Lingui-minimal) and YAML (Rails-style). ARB / xcstrings / FormatJS-with-ICU refused-by-default with `--format raw-json` escape hatch. See [`docs/file-translate-guide.md`](docs/file-translate-guide.md) and [`docs/file-translate-test-report.md`](docs/file-translate-test-report.md).

**7. ~~No batch translation mode~~** ✅ Subsumed by #6
- Translating a JSON catalog effectively batches strings — adapter loads once, glossary opens once, atomic write at end. Stdin pipe support (`echo "hello" | tl --to ar`) is still missing as a separate feature; carried as a future improvement.

**8. Raycast extension is 0% implemented**
- Directory `apps/raycast/` exists with `node_modules` but zero source files.
- Recommendation: implement a basic Raycast extension (translate selected text, glossary lookup).

**9. Glossary domain filter not applied during translation**
- `glossary list --domain` works, but during actual translation the domain filter is never passed to the glossary lookup in the pipeline.
- File: `apps/cli/src/commands/translate.ts`, `packages/core/src/pipeline.ts`
- Fix: expose `--domain` on the `translate` command and thread it through to `GlossaryStore.list()`.

**10. No translation memory / fuzzy cache**
- If the same phrase was translated before, it is re-translated from scratch every time.
- The SQLite infra already exists. A thin TM layer on top would give instant results for repeated strings and improve consistency.
- Industry standard feature present in all competing tools.

---

## 🟡 Medium — UX / DX Problems

**11. TUI hardcodes target language to `"fr"`**
- File: `apps/tui/src/views/translate.ts:45`
- The TUI ignores the user's config default for target language and always defaults to French.
- Fix: read `config.defaults.targetLang` on init.

**12. No `tl languages` command**
- Users have no way to discover supported language codes from the CLI. They must check source code or docs.
- Fix: add `tl languages` that lists all entries in `SUPPORTED_LANGUAGES` with their codes.

**13. No progress indicator for slow operations**
- Context indexing, large glossary imports, and Ollama cold-start block silently. Users think the tool hung.
- Fix: spinner or "indexing…" status line for operations that take >500ms.

**14. TUI glossary table has fixed 120-column widths**
- File: `apps/tui/src/views/glossary.ts:33-36`
- Table headers are hardcoded to 120 chars. TUI breaks or wraps awkwardly on terminals narrower than 120 columns.
- Fix: compute column widths dynamically from terminal width.

**15. No `--from auto` feedback in output**
- When `--from` is omitted, the tool uses config `sourceLang` (often "auto") but the result metadata does not say what language was actually detected.
- Fix: include detected source language in output metadata.

**16. No glossary dry-run / CSV validation before import**
- File: `apps/cli/src/commands/glossary.ts:144-155`
- CSV import only validates during insertion. There is no `--dry-run` to check format before committing.
- Fix: add `tl glossary import --dry-run` that validates rows without writing to DB.

**17. No context retrieval debug command**
- `ContextStore.retrieve()` exists but there is no CLI command to test what snippets are retrieved for a query.
- Fix: add `tl context query "<text>"` to show ranked context snippets for debugging relevance.

**18. Ambiguous exit codes**
- All errors exit with code `1`. Scripts cannot distinguish user input errors, system errors, and translation failures.
- Fix: define exit code constants (e.g. 2 = input error, 3 = system error, 4 = glossary strict miss) and use them consistently.

**19. JSON output includes non-deterministic metadata**
- File: `apps/cli/src/formatters/output.ts:17-18`
- `durationMs` and `retries` vary per invocation. Scripts parsing JSON must ignore these fields.
- Fix: add `--no-metadata` flag to strip timing/retry fields from JSON output.

**20. No multi-language pair workflow**
- Config only supports one default target language. No convenient way to manage glossaries or defaults for multiple language pairs.
- Recommendation: support named profiles in config (e.g. `--profile en-ar`).

---

## 🟡 Medium — Code Quality Issues

**21. No Base64 validation before sending image to adapter**
- Files: `apps/cli/src/commands/translate.ts:92-93`, `apps/tui/src/views/translate.ts:267-268`
- Image is read and Base64-encoded but no check that encoding succeeded. Corrupt/partial Base64 is forwarded silently.
- Fix: validate Base64 output is non-empty before proceeding.

**22. Context tokenizer broken for non-Latin scripts**
- File: `packages/core/src/context.ts:8-10`
- Tokenizer regex `[a-z0-9]{3,}` produces garbage for Arabic, CJK, Hebrew, Thai, etc. — the tool's primary use cases. Context retrieval is effectively broken for these scripts.
- Fix: use a Unicode-aware tokenizer (e.g. split on whitespace and punctuation, support Unicode word boundaries).

**23. Duplicate context sources possible via symlinks**
- File: `apps/cli/src/commands/context.ts:60-65`
- `resolve()` does not follow symlinks, so the same directory symlinked at two paths can be added twice.
- Fix: use `realpath` / `fs.realpathSync` before storing.

**24. Non-null assertion without guard in glossary utils**
- File: `packages/shared/src/utils/text.ts:83`
- `hits.find(...)!.entry.targetTerm` uses a non-null assertion. If `find()` returns undefined (malformed DB data), this throws a runtime error.
- Fix: add a null check or use optional chaining with a fallback.

**25. Config tilde expansion edge case**
- File: `packages/core/src/config.ts:96-98`
- `expandTilde()` only handles `~/`. A path typed as `~ /config` or just `~` is not expanded.
- Fix: handle `~` alone and trim before checking.

**26. Context store re-indexing is always full**
- File: `packages/core/src/context.ts:164-224`
- Re-indexing always processes all files from scratch. No incremental indexing (only new/changed files).
- Fix: track file mtimes in the DB and skip unchanged files during reindex.

**27. Glossary conflict resolution not exposed**
- If two entries share the same source term for the same language pair, the DB UNIQUE constraint prevents duplicates silently. There is no UI or CLI to view or resolve conflicts.
- Fix: add `tl glossary conflicts` command and a `--overwrite` flag on import.

**28. Config has no schema versioning**
- File: `packages/core/src/config.ts`
- No version field in the config schema. When new fields are added, old configs silently pick up defaults. No migration path for breaking changes.
- Fix: add a `version` field and a migration function.

---

## 🟢 Test Coverage Gaps

**29. Zero TUI view tests**
- `apps/tui/src/views/` has no test coverage at all. These are complex stateful components with event handlers and render logic.
- Risk: any refactor is high-risk with no safety net.

**30. No e2e tests for glossary + translate together**
- The integration between glossary enforcement and the translation pipeline is not tested end-to-end.
- Fix: add integration tests using `MockAdapter` that verify glossary terms are actually applied in output.

**31. No adapter robustness tests**
- `TranslateGemmaLocalAdapter` streaming tests mock fetch but don't cover: malformed NDJSON mid-stream, empty response body, mixing empty chunks with real chunks, very large chunks (>1 MB).

**32. No tests for CLI JSON error output**
- No tests verify that `TlError` with `tag` + `hint` is correctly serialized to JSON when `--json` is used and that the output is parseable.

**33. No tests for config edge cases**
- Missing: config file exists but is unreadable (permissions), config directory unwritable, tilde expansion with unusual home directory paths.

**34. No tests for image handling edge cases**
- Missing: corrupted image file, symlink to image, file exactly at 10 MB boundary, file under 100 bytes.

---

## 🟢 Low — Competitive Features Worth Adding Later

**35. CI/CD mode**
- A `--ci` flag that: disables interactive prompts, outputs machine-readable JSON only, uses granular exit codes, and fails fast on any warning.
- Crowdin and Lokalise CLI both have dedicated CI modes. Needed for GitHub Actions adoption.

**36. REST API / HTTP server mode**
- `tl serve --port 3000` for programmatic access from web apps, scripts, and automation frameworks without spawning a subprocess.

**37. Shell completions**
- `tl --completion bash/zsh/fish` — Commander.js makes this straightforward but it is missing.
- Without completions the tool feels unpolished to CLI power users.

**38. Adapter plugin system**
- File: `packages/adapters/src/factory.ts:7-23`
- Adapters are hardcoded. Adding a new backend requires editing `factory.ts`.
- Fix: support loading adapter modules from config (e.g. `"adapter": "my-custom-adapter"`).

**39. Over-the-Air (OTA) translation updates**
- Modern mobile localization tools push translation updates to apps without a new release via Edge CDN.
- Long-term consideration for teams building mobile apps with `tl` in their pipeline.

**40. Subtitle / document translation**
- Microsoft Document Translation and others support `.srt`, `.pdf`, `.docx`, `.md` files.
- A `tl translate --file slides.md --to ar` command preserving markdown structure would be high-value.

---

## Competitive Landscape Summary

| Tool | Cloud Adapters | File Formats | Translation Memory | CI/CD | Open Source |
|------|---------------|--------------|-------------------|-------|-------------|
| **tl** | ❌ Ollama only | ❌ Strings only | ❌ | ❌ | ✅ |
| attranslate | ✅ OpenAI, DeepL, etc. | ✅ JSON, YAML, PO, XML, ARB | ❌ | ✅ | ✅ |
| Lokalise CLI | ✅ | ✅ | ✅ | ✅ | ❌ (paid) |
| Crowdin CLI | ✅ | ✅ | ✅ | ✅ | ❌ (paid) |
| Argos Translate | ✅ Local models | ⚠️ Via library | ❌ | ❌ | ✅ |

`tl`'s unique advantages: local-first, privacy-preserving, glossary enforcement, context-aware, TUI, free.
The clearest path to competitiveness: **cloud adapters + file format support**.

---

## Recommended Implementation Order

| # | Item | Effort | Priority |
|---|------|--------|----------|
| 1 | Fix Ollama timeout (AbortController) | 30 min | 🔴 Critical |
| 2 | Fix TUI glossary silent error | 30 min | 🔴 Critical |
| 3 | Fix glossary coverage reporting (0 hits ≠ 100%) | 20 min | 🔴 Critical |
| 4 | Fix TUI target lang hardcoded to `"fr"` | 10 min | 🟠 High |
| 5 | Fix domain filter threading into translate pipeline | 1 hr | 🟠 High |
| 6 | Add `tl languages` command | 1 hr | 🟡 Medium |
| 7 | Add granular exit codes | 2 hr | 🟡 Medium |
| 8 | Fix context tokenizer for non-Latin scripts | 1 day | 🟠 High |
| 9 | Add OpenAI / Anthropic adapter | 2–3 days | 🟠 High |
| 10 | Add file format translation (JSON, YAML, PO) | 3–5 days | 🟠 High |
| 11 | Add translation memory layer | 1–2 days | 🟡 Medium |
| 12 | Fix image translation (OCR or docs) | 1–2 days | 🔴 Critical |
| 13 | Add TUI view tests | 2–3 days | 🟡 Medium |
| 14 | Add CI/CD mode (`--ci` flag) | 1 day | 🟢 Low |
| 15 | Implement Raycast extension | 3–5 days | 🟢 Low |
| 16 | Add REST API server mode | 3–5 days | 🟢 Low |
| 17 | Shell completions | 2 hr | 🟢 Low |
| 18 | Adapter plugin system | 2–3 days | 🟢 Low |

---

*Sources: full codebase review + [attranslate](https://github.com/fkirc/attranslate), [Lokalise blog](https://lokalise.com/blog/best-ai-translation-tools/), [Crowdin CI/CD docs](https://crowdin.github.io/crowdin-cli/ci-cd), [Transifex localization guide 2026](https://www.transifex.com/blog/best-tools-for-software-localization-a-developers-guide-2026), [Localazy CLI](https://localazy.com/features/cli)*
