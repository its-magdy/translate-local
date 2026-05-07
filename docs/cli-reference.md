# CLI Reference

## Overview

```
tl [command] [options]
```

Running `tl` with no arguments launches the interactive TUI. Passing text directly is shorthand for `tl translate`:

```bash
tl "hello world" --from en --to ar
# equivalent to:
tl translate "hello world" --from en --to ar
```

---

## Commands

### `tl translate <text>`

Translate a string, image, or JSON/YAML catalog file.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--from <lang>` | string | `auto` | Source language (BCP-47 tag, e.g. `en`, `fr`) or `auto` |
| `--to <lang>` | string | `ar` | Target language (BCP-47 tag) |
| `--glossary <mode>` | `prefer\|strict` | `prefer` | Glossary enforcement mode |
| `--image <path>` | string | — | Path to an image file; extracts and translates the text in it |
| `--file <path>` | string | — | Path to a JSON or YAML catalog (see [File mode](#file-mode) below) |
| `--json` | flag | off | Output result as JSON |

The three input modes (`[text]`, `--image`, `--file`) are mutually exclusive.

**Examples:**

```bash
tl "good morning" --from en --to ar
tl translate "bonjour" --from fr --to en --glossary strict
tl "hello" --to de --json
tl translate --image screenshot.png --to ar
tl translate --file en.json --to ar          # see File mode
```

**JSON output shape (string / image mode):**

```json
{
  "translated": "...",
  "sourceLang": "en",
  "targetLang": "ar",
  "glossaryCoverage": 1.0,
  "missingTerms": [],
  "metadata": { "adapter": "translate-gemma-local", "durationMs": 420, "retries": 0 }
}
```

#### File mode

Translates a JSON or YAML i18n catalog. By default, only **missing**, **empty**, **null**, and **whitespace-only** target values are translated; existing translations are preserved.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--file <path>` | string | — | **Required** for file mode. Source catalog path. |
| `--out <path>` | string | inferred | Output path. If omitted, inferred by locale-token replacement (e.g. `en.json` → `ar.json`, `messages.en.yaml` → `messages.ar.yaml`, `locales/en/common.json` → `locales/ar/common.json`). |
| `--force` | flag | off | Re-translate every leaf, overwriting existing target values. |
| `--dry-run` | flag | off | Report what would be translated; write nothing. |
| `--format <fmt>` | `auto\|json\|yaml\|raw-json\|raw-yaml` | `auto` | Format override. `raw-*` bypasses content-shape refusal — use at your own risk. |
| `--strict` | flag | off | Abort the run on first validation failure (e.g. placeholder mismatch). Default behavior is to record failed keys, fall back to source, and continue — exit code is non-zero (`2`) if any keys failed. |
| `--translate-all` | flag | off | Bypass URL / email / semver / ALL-CAPS skip heuristics. |
| `--max-size <mb>` | number | `20` | Source file size cap. |

**Examples:**

```bash
# Sync mode — only translates missing/empty keys in ar.json
tl translate --file en.json --to ar

# Re-translate everything
tl translate --file en.json --to ar --force

# See what would change without writing
tl translate --file en.json --to ar --dry-run

# Power-user: translate every leaf in an ARB file (may corrupt @key metadata)
tl translate --file en.arb --to ar --format raw-json --out ar.arb

# Strict mode: abort on first failure (default is to continue and report)
tl translate --file en.json --to ar --strict
```

**Supported formats (Phase A — JSON only; YAML in Phase B):**

| Format | Status | Notes |
|---|---|---|
| Vanilla JSON (flat or nested) | ✅ supported | Default for `.json`. |
| Lingui minimal mode | ✅ supported | Treated as vanilla. |
| i18next with plural keys (`_one`, `_other`, …) | ✅ supported | Each plural form is translated 1:1; CLDR category mismatch warning emitted. |
| YAML (Rails / Hugo / Symfony non-ICU) | ✅ supported | Default for `.yaml` / `.yml`. Comments, key order, and block scalar style preserved on round-trip. |
| Flutter ARB | ❌ refused | `@key` metadata + ICU MessageFormat. Use `--format raw-json` to override. |
| Apple `.xcstrings` | ❌ refused | Per-locale `stringUnit` state machine. Use `--format raw-json` to override. |
| FormatJS / react-intl extracted catalog | ❌ refused | ICU bodies in `defaultMessage`. Use `--format raw-json` to override. |
| Lingui full mode | ❌ refused | Multi-field per-key shape. |
| YAML with anchors / aliases | ❌ refused | Modifying an anchored value mutates all aliases. Inline before translating. |
| YAML 1.1 directive (`%YAML 1.1`) | ❌ refused | Norway problem and other implicit-typing edge cases. Re-save as 1.2. |
| Multi-document YAML | ❌ refused | Split into separate files. |

**Placeholder protection.** All common placeholder syntaxes are detected and protected: `{{name}}` (i18next), `{name}` (Vue / ICU simple), `%{name}` (Rails), `%s`/`%d`/`%1$s` (printf), `$t(...)` (i18next nesting), `@:linked` (Vue), HTML tags. Strings containing ICU `{n, plural, ...}` / `{x, select, ...}` blocks are refused; under the default (continue-on-failure) behavior these keys fall back to the source value, or pass `--strict` to abort.

**Skip heuristics.** Values that look like URLs (`https?://...`), email addresses, semver versions, single characters, or ALL-CAPS short tokens (`OK`, `API`, `ID_X`) are passed through unchanged. Override with `--translate-all`.

**JSON output shape (file mode):**

```json
{
  "contentFormat": "vanilla",
  "totalLeaves": 12,
  "translated": 10,
  "skipped": { "count": 2, "reasons": { "url": 1, "all-caps-short": 1 } },
  "failed": [],
  "warnings": [],
  "outPath": "/path/to/ar.json"
}
```

See [`docs/file-translate-guide.md`](file-translate-guide.md) for deeper coverage of format detection, sync semantics, edge cases, and refused-format rationales.

---

### `tl glossary`

Manage the glossary database.

#### `tl glossary add`

Add a term pair.

| Flag | Required | Description |
|------|----------|-------------|
| `--source <term>` | yes | Source term |
| `--target <term>` | yes | Target translation |
| `--from <lang>` | yes | Source language |
| `--to <lang>` | yes | Target language |
| `--domain <domain>` | no | Domain label (e.g. `legal`, `medical`) |
| `--note <note>` | no | Free-text note |

```bash
tl glossary add --source "machine learning" --target "تعلم الآلة" --from en --to ar
tl glossary add --source "API" --target "واجهة برمجية" --from en --to ar --domain tech
```

#### `tl glossary list`

List stored entries.

| Flag | Description |
|------|-------------|
| `--from <lang>` | Filter by source language |
| `--to <lang>` | Filter by target language |
| `--domain <domain>` | Filter by domain |
| `--json` | Output as JSON array |

```bash
tl glossary list --from en --to ar
tl glossary list --json
```

#### `tl glossary remove <id>`

Remove an entry by its ID (the ID is shown in `tl glossary list --json`).

```bash
tl glossary remove a1b2c3d4-...
```

#### `tl glossary import <file>`

Import entries from a CSV file.

```bash
tl glossary import ./terms.csv
```

See [glossary-guide.md](glossary-guide.md) for the CSV format.

#### `tl glossary export`

Export the glossary to stdout.

| Flag | Description |
|------|-------------|
| `--from <lang>` | Filter by source language |
| `--to <lang>` | Filter by target language |
| `--json` | Output JSON instead of CSV |

```bash
tl glossary export --from en --to ar > my-glossary.csv
tl glossary export --json
```

---

### `tl context`

Manage context sources (local directories indexed for retrieval).

#### `tl context add <path>`

Add a directory as a context source and index it immediately.

```bash
tl context add ~/docs/legal-corpus
```

#### `tl context list`

List registered context sources.

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

```bash
tl context list
```

#### `tl context remove <path>`

Remove a context source and its index.

```bash
tl context remove ~/docs/legal-corpus
```

#### `tl context index`

Re-index all registered context sources (picks up new/changed files).

```bash
tl context index
```

---

### `tl config`

Manage the configuration file at `~/.config/tl/config.jsonc`.

#### `tl config connect`

Configure the adapter backend.

| Flag | Default | Description |
|------|---------|-------------|
| `--backend <type>` | `local` | `local` (Ollama) |
| `--model <name>` | `translategemma:latest` | Model name |
| `--endpoint <url>` | `http://localhost:11434` | Ollama API URL |

```bash
tl config connect --backend local --model translategemma:latest
```

#### `tl config status`

Print current configuration and test the adapter connection.

```bash
tl config status
```

#### `tl config path`

Print the path to the config file.

```bash
tl config path
# ~/.config/tl/config.jsonc
```

---

### `tl languages`

List all supported BCP-47 language codes and their display names.

```bash
tl languages
#   af     Afrikaans
#   ar     Arabic
#   ...

tl languages --json   # output as JSON object { "ar": "Arabic", ... }
```

| Flag | Description |
|------|-------------|
| `--json` | Output as a JSON object instead of a table |

---

### `tl completion <shell>`

Print a shell completion script for `bash`, `zsh`, or `fish` to stdout. The
generator emits a fully static script — language codes, glossary modes, and
format choices are baked in at generate time, so completions work without
calling back into `tl` on every Tab press.

```bash
tl completion bash
tl completion zsh
tl completion fish
```

| Argument | Description |
|----------|-------------|
| `<shell>` | One of `bash`, `zsh`, `fish` |

**What gets completed:**
- Top-level commands (`translate`, `glossary`, `context`, `config`, `languages`, `completion`).
- Subcommands of `glossary`, `context`, and `config`.
- All long flags for each (sub)command.
- Language codes (60+) on `--from` and `--to`.
- Choice values: `--glossary {prefer,strict}`, `--format {auto,json,yaml,raw-json,raw-yaml}`, completion `<shell>`.
- File path completion for `--image`, `--file`, `--out`, `glossary import <file>`, `context add|remove <path>`. Path completion is delegated to the shell's built-in file completion — bash/zsh additionally restrict by extension where useful.

#### Install — bash

```bash
# Current shell only:
eval "$(tl completion bash)"

# Persistent (per-user):
tl completion bash >> ~/.bashrc

# System-wide (requires sudo):
tl completion bash | sudo tee /etc/bash_completion.d/tl > /dev/null
```

#### Install — zsh

```bash
# Persistent: drop into a directory on your fpath
tl completion zsh > "${fpath[1]}/_tl"

# Or keep your own completions dir
mkdir -p ~/.zsh/completions
tl completion zsh > ~/.zsh/completions/_tl
# Then in ~/.zshrc:
#   fpath=(~/.zsh/completions $fpath)
#   autoload -U compinit && compinit

# Current shell only:
eval "$(tl completion zsh)"
```

After installing, run `compinit` (or open a new shell) to activate.

#### Install — fish

```bash
tl completion fish > ~/.config/fish/completions/tl.fish
```

Fish auto-loads completion files from that directory. Open a new shell or
`source` the file to activate immediately.

#### Notes

- The completion script does **not** require `tl` to be on `PATH` at completion time — language codes and choices are baked in at generate time.
- Re-run `tl completion <shell>` after upgrading `tl` if new commands or flags were added.
- PowerShell is not supported.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TL_CONFIG` | Path to a custom config file. Overrides the default `~/.config/tl/config.jsonc`. |

---

## RTL languages and terminal compatibility

When translating to a right-to-left language (Arabic, Hebrew, Persian, Urdu,
etc.), the visual quality of `tl`'s output depends almost entirely on which
terminal you run it in. `tl` itself emits canonical logical-order UTF-8 — it
is up to the terminal to perform Arabic letter joining (shaping) and
Unicode UAX#9 BiDi reordering.

As of April 2026, only a minority of popular terminals do this correctly.
The table below summarizes verified behavior; if your terminal is not
listed, assume it does not support RTL.

| Terminal | Shaping (letter joining) | BiDi reorder (UAX#9) | Notes |
|----------|---|---|---|
| GNOME Terminal / VTE | Yes | Yes | `enable-bidi` is on by default. Recommended on Linux. |
| Konsole (KDE) | Yes | Yes | Renders RTL from the right edge of the pane. Recommended on KDE. |
| mlterm | Yes | Yes | Reference implementation for RTL terminals. |
| iTerm2 ≥ 3.6 | Yes (experimental) | Partial | Enable Settings → General → Experimental → "Enable support for right-to-left scripts". Mixed LTR/RTL still imperfect. Recommended on macOS. |
| macOS Terminal.app | No | Partial | Reorders, but does not join Arabic letters. |
| Ghostty | No | No | Tracking [ghostty#11079](https://github.com/ghostty-org/ghostty/pull/11079) and [#1442](https://github.com/ghostty-org/ghostty/issues/1442). Until merged, Arabic appears in logical-LTR order. |
| kitty | No | No | Has `force_ltr`; recommended workaround is piping through GNU FriBidi externally. |
| WezTerm | No | Opt-in | `experimental_bidi = true` enables UAX#9 but with known glyph-width bugs. |
| Alacritty | No | No | Explicit non-goal. |
| Windows Terminal | No | No | Tracking [microsoft/terminal#19076](https://github.com/microsoft/terminal/issues/19076). |
| Warp | No | No | Documented in [warpdotdev/Warp#3589](https://github.com/warpdotdev/Warp/issues/3589). |
| VS Code integrated terminal | No | No | xterm.js limitation. |
| tmux (passthrough) | n/a | Breaks layout | tmux corrupts pane geometry on logical-order RTL regardless of host. See [tmux#2425](https://github.com/tmux/tmux/issues/2425). |

**Recommendation:** if you regularly translate to Arabic or another RTL
language, use one of the terminals in the top four rows. On macOS, the
practical choice is **iTerm2 with the experimental RTL flag enabled**. On
Linux, **Konsole** or **GNOME Terminal** work out of the box.

**Piping and files are always correct:** `tl` emits canonical logical-order
UTF-8 to non-TTY destinations (`tl ... > out.txt`, `tl ... | grep`,
`tl ... --json`), so RTL output remains correct and searchable in any text
editor or downstream tool — only the live terminal display is affected by
the limitations above.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (adapter failure, glossary strict miss, config invalid, etc.) |

Error messages are printed to stderr with an actionable hint when available.
