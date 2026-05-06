# File translation guide

Deep reference for `tl translate --file <path>`. Companion to the [CLI reference](cli-reference.md#file-mode) entry; this page covers detection rules, sync semantics, placeholder algorithm, edge cases, and the rationale for refused formats.

---

## Quick start

```bash
# Translate en.json → ar.json (only fills in missing/empty keys)
tl translate --file en.json --to ar

# See what would change without writing
tl translate --file en.json --to ar --dry-run

# Re-translate everything
tl translate --file en.json --to ar --force

# Override output path
tl translate --file path/to/en.json --to ar --out path/to/ar.json
```

---

## Output path inference

When `--out` is omitted, `tl` infers the output path by replacing a locale token in the source filename. Three layouts are recognized, in priority order:

| Layout | Source | Output (target=ar) |
|---|---|---|
| `<lang>.<ext>` | `en.json` | `ar.json` |
| `<file>.<lang>.<ext>` | `messages.en.yaml` | `messages.ar.yaml` |
| `<parent>/<lang>/<file>` | `locales/en/common.json` | `locales/ar/common.json` |

When `--from` is `auto` (default), any BCP-47-shaped token in the filename (e.g. `en`, `de`, `zh-CN`) is treated as the source locale. When `--from` is explicit, only that exact code is matched.

If no token can be detected, `tl` errors with `INVALID_INPUT` and asks you to pass `--out`.

---

## Sync semantics

The default mode is `missing-only`. A target value is translated when:

| Target value | Translated? |
|---|---|
| Key absent from target file | yes |
| `""` (empty string) | yes |
| `null` | yes |
| Whitespace-only (`"   "`, `"\n\t"`) | yes |
| Any other non-empty string | **no** (preserved) |
| Number, boolean, array, object | preserved verbatim |

Pass `--force` to re-translate every leaf regardless of existing target value.

**What `tl` does NOT do (deferred):**

- **Source-changed detection.** If a source string changed but the target key still exists, `tl` cannot tell — there is no translation memory in v1. Use `--force` if you suspect drift, or delete the target key to opt into re-translation.
- **Stale-key pruning.** Keys present in the target but absent from the source are left alone. No `--prune` flag in v1.

---

## Format detection

`tl` first parses by extension (`.json` / `.yaml` / `.yml`), then inspects the parsed content shape. Detection priority:

1. **xcstrings** — `{ sourceLanguage, version, strings: { ... } }` → refused (Apple's per-locale state machine needs format-aware handling).
2. **ARB** — any top-level key matching `@<name>` or `@@locale` / `@@last_modified` → refused (ARB metadata blocks must not be translated; ICU bodies need full parsing).
3. **FormatJS catalog** — value shape `{ defaultMessage: string, ... }` → refused (defaultMessage commonly contains ICU MessageFormat).
4. **Lingui full mode** — value shape `{ translation, message, description, origin }` → refused.
5. **i18next plurals** — leaf key matching `_{zero|one|two|few|many|other}$` with sibling stem → supported, with a warning that target-locale CLDR plural categories may differ from source.
6. **Vanilla** — anything else.

Override detection with `--format <fmt>`:

- `--format json` / `yaml` — force the parser, but still apply content-shape detection.
- `--format raw-json` / `raw-yaml` — bypass content-shape detection entirely. Translates every string leaf regardless of metadata. Useful for one-off translation of refused formats, but **may corrupt** ARB `@key` metadata, xcstrings state fields, or ICU body keywords.

---

## Placeholder protection

`tl` extracts placeholders from each source value, replaces them with ASCII sentinel tokens (`__TLPH_0__`, `__TLPH_1__`, …) before sending to the model, and restores them after. Each sentinel is also injected as a synthetic glossary hit, which wraps it in the `<term translation="X">` mechanism the underlying model is well-trained to preserve. The translated output is then re-scanned for placeholders and validated against the source via multiset equality.

If validation fails (the model dropped or altered a placeholder), the orchestrator retries up to **10 times** with the same input. Translation models are non-deterministic and a different sample very often succeeds; with a per-attempt success rate of ~50% on the hardest cases, 10 retries gives an effective success rate of ~99.9%. If all retries fail, the source value is written to the target as a fallback and the key is recorded in the failed list. The whole run then exits with code `2` so CI catches it. Pass `--strict` to switch to abort-on-first-failure.

The prompt also includes few-shot examples showing the model how source-with-sentinels should round-trip to target-with-sentinels-preserved across multiple languages. This is the primary lever for placeholder fidelity; the retries only catch residual sampling noise.

**Reliability notes (measured against translategemma):** single- and multi-placeholder strings across all supported families (`{{name}}`, `{name}`, `%{name}`, `%s`, `%1$s`, `$t()`, `@:linked`, HTML tags) preserve reliably end-to-end. The previously-flaky combinations (Rails `%{user}` + `%{count}` together, bare printf `%s` + `%d` together) succeeded 10/10 in stability testing after the few-shot + retry-bump tuning. Long-tail edge cases still hit the source-fallback path occasionally; that path is non-fatal and clearly reported.

**Recognized placeholder families:**

| Pattern | Used by | Example |
|---|---|---|
| `{{name}}` | i18next, Mustache | `Hello {{name}}` |
| `{name}` / `{0}` | Vue I18n, ICU simple | `Click {action}` |
| `%{name}` | Rails I18n | `Bonjour %{user}` |
| `%s` / `%d` / `%f` | printf | `%s items left` |
| `%1$s` / `%2$d` | positional printf (Android, gettext) | `%1$s and %2$d` |
| `$t(key)` | i18next nesting | `Press $t(button.ok)` |
| `@:key` / `@.upper:key` | Vue I18n linked | `@:nav.home` |
| `<tag>...</tag>` | inline HTML | `Use <b>bold</b>` |

**Validation:** multiset equality. The set of placeholders extracted from the model output must exactly match the source — same identities, same counts. Reordering is allowed (RTL languages legitimately move placeholders around).

**Failure mode (default):** a placeholder mismatch is recorded in the run summary and the source value is written to the target as a fallback (so the output file remains complete and you can grep for un-translated source text). The exit code is non-zero (`2`) if any keys failed, so CI catches it. Pass `--strict` to switch to abort-on-first-failure (the original target file is then left untouched).

**ICU MessageFormat** — strings containing `{n, plural, ...}`, `{x, select, ...}`, `{x, selectordinal, ...}`, or ICU number/date format directives are refused. Partial-ICU translation requires a full ICU AST parser, which is deferred to a future phase. Use `--continue-on-error` to skip these strings.

---

## Skip heuristics

Values matching any of the following are passed through verbatim, not translated:

- URLs: `^https?://...$`
- Emails: standard RFC5322-lite pattern
- Semver: `^v?\d+\.\d+\.\d+(...)?$`
- Single character: `len(value) == 1`
- ALL-CAPS short tokens: `^[A-Z][A-Z0-9_]{0,3}$` (e.g. `OK`, `API`, `ID_X`)
- Empty string, whitespace-only

Override all of these with `--translate-all`.

---

## Atomic write

`tl` always writes the output via temp-file-plus-rename:

1. Serialize the in-memory target tree to a string.
2. Write to `<dir>/.<basename>.tmp-<pid>` in the same directory.
3. `rename()` to the final path.

This is atomic on POSIX filesystems. If `tl` is killed mid-run, the original target file is untouched. After the run, the tmp file is gone (or, on rename failure, cleaned up best-effort).

`tl` then re-parses the output to confirm it round-trips cleanly. A re-parse failure aborts before the rename — you get an error, not a corrupted file.

---

## Round-trip fidelity

For JSON, the following are preserved on write:

- **Indentation:** detected from the source (2-space, 4-space, or tab); fallback is 2-space.
- **Line endings:** detected from the source (LF or CRLF).
- **Trailing newline:** present-or-absent matches the source.
- **Key order:** new keys appended at the position of their source counterpart; existing keys retain their order.
- **UTF-8 BOM:** stripped on read; never written back. (BOM in JSON breaks `JSON.parse` in many tools; we don't propagate the problem.)

For YAML (via the `yaml` package's Document API), additionally preserved:

- **Comments** above and inline with keys.
- **Block scalar style** — literal `|` and folded `>` are kept; if the source value used `|`, the translated value will too (forced single-line strings get block-quoted automatically when long).
- **Quoting style** per scalar (plain, single-quoted, double-quoted).
- **Key insertion order** within maps.

Long translated strings are not reflowed — the writer is configured with `lineWidth: 0` so the content you put in is the content that comes out. Anchors and aliases are not supported (refused at read time).

---

## Edge case behavior

| Case | Behavior |
|---|---|
| BOM in source | Stripped on read, not emitted. |
| CRLF source | Preserved on write. |
| File > 20 MB | Refused with `FILE_TOO_LARGE`. Override with `--max-size`. |
| Source file is a symlink | Read/written at the symlinked path; the link is not dereferenced. |
| Same source and target locale (`--from en --to en`) | Refused with `SAME_LOCALE`. |
| Source file does not exist | Refused with `FILE_NOT_FOUND`. |
| Existing target is invalid JSON | Refused with `FILE_PARSE_FAILED`. Fix or delete the target before re-running. |
| Duplicate keys in JSON source | `JSON.parse` last-wins (warning future v1). |
| Keys with dots (`"section.title"`) | Treated as opaque string keys, not split paths. |
| Numeric values (number, boolean, null) | Preserved verbatim. |
| Arrays of strings | Each element translated; index preserved. |
| Deeply nested (>64 levels) | Refused — likely malformed input. |
| Strings >context-window | Translated as-is; the model may truncate. No splitting in v1. |

---

## Glossary and context in file mode

Glossary terms are applied per leaf, exactly as they would be for a single-string translation. The same `--glossary prefer|strict` flag governs both modes.

Context retrieval also runs per leaf, with the source value as the query. If you've added a context source via `tl context add`, snippets are retrieved per-key. The current tokenizer is best for Latin-script source values; short or non-Latin values may yield empty context (a known limitation).

---

## Refused formats — rationale and workarounds

| Format | Why refused | Workaround |
|---|---|---|
| **Flutter ARB** | `@key` blocks contain `placeholders` metadata that must not be translated; values frequently contain ICU MessageFormat. Translating every leaf would corrupt both. | `--format raw-json` translates every leaf (corrupts metadata). Wait for Phase C for proper ARB support. |
| **Apple `.xcstrings`** | Per-locale `stringUnit.state` machine (`translated`, `needs_review`, `new`, `stale`) drives Xcode's UI; the format also has plural variations. | `--format raw-json` translates every leaf (state fields will be left as English string values). Wait for Phase C. |
| **FormatJS catalogs** | Values commonly contain ICU plural/select bodies. Treating them as opaque strings sends English fragments to the model unchanged; treating them as text corrupts ICU keywords. | `--format raw-json`. Better: keep your translations in Lingui-minimal style. |
| **Lingui full mode** | The multi-field shape (`translation`, `message`, `description`, `origin`) needs a strategy for which fields to translate, which to leave. | Use Lingui minimal mode (`{ id: "translation" }`). |
| **Multi-document YAML** (`---` separator) | Phase B refusal — uncommon in i18n catalogs; supporting it cleanly needs work we haven't done. | Split the file. |
| **YAML 1.1 directive** (`%YAML 1.1`) | The Norway problem (`no` → `false`) and other implicit-typing bugs make round-trip unreliable. | Re-save as YAML 1.2 (modern editors default to this). |
| **YAML anchors / aliases** | Modifying an anchored value mutates all aliases. Translating once propagates everywhere — sometimes desirable, sometimes not. Detecting "shared between translatable and non-translatable contexts" is hard to do safely. | Inline the alias. |
| **Strings containing ICU plural/select** | Without a real ICU parser, we cannot reliably translate the natural-language fragments inside while leaving the keywords (`plural`, `=0`, `one`, `other`) unchanged. | `--continue-on-error` skips them; or pre-extract them into a separate non-ICU file. |

---

## Errors

All errors carry a `tag` and a `hint`. With `--json`, errors serialize as `{ "error": <tag>, "message": "...", "hint": "..." }`.

| Tag | Meaning |
|---|---|
| `FILE_NOT_FOUND` | Source file does not exist. |
| `FILE_TOO_LARGE` | Source exceeds `--max-size`. |
| `FILE_INVALID_TYPE` | Extension not recognized; pass `--format`. |
| `FILE_PARSE_FAILED` | JSON / YAML parse error. |
| `FILE_INVALID_FORMAT` | Refused content shape (ARB, xcstrings, ICU, etc.). |
| `FILE_WRITE_FAILED` | Output write or post-write re-parse failed. |
| `FILE_EMPTY` | The file has no translatable leaves. |
| `PLACEHOLDER_MISMATCH` | The model's output dropped or altered placeholders. |
| `SAME_LOCALE` | `--from` and `--to` are the same. |

---

## What's coming next

- **Phase B (YAML)** — Rails / Hugo / Symfony non-ICU catalogs with full comment, anchor, and block-scalar preservation.
- **Phase C (later)** — proper ARB and xcstrings handling, ICU body translation with a real AST parser, plural-category regeneration (en→ar 2→6 forms), source-changed detection via a translation-memory cache.
