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

Translate a string.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--from <lang>` | string | `auto` | Source language (BCP-47 tag, e.g. `en`, `fr`) or `auto` |
| `--to <lang>` | string | `ar` | Target language (BCP-47 tag) |
| `--glossary <mode>` | `prefer\|strict` | `prefer` | Glossary enforcement mode |
| `--image <path>` | string | — | Path to an image file; extracts and translates the text in it |
| `--json` | flag | off | Output result as JSON |

**Examples:**

```bash
tl "good morning" --from en --to ar
tl translate "bonjour" --from fr --to en --glossary strict
tl "hello" --to de --json
tl translate --image screenshot.png --to ar
```

**JSON output shape:**

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
| `--model <name>` | `translate-gemma-12b` | Model name |
| `--endpoint <url>` | `http://localhost:11434` | Ollama API URL |

```bash
tl config connect --backend local --model translate-gemma-12b
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
