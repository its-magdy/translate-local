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
| `--json` | flag | off | Output result as JSON |

**Examples:**

```bash
tl "good morning" --from en --to ar
tl translate "bonjour" --from fr --to en --glossary strict
tl "hello" --to de --json
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
| `--backend <type>` | `local` | `local` (Ollama) or `huggingface` |
| `--model <name>` | `translate-gemma-12b` | Model name |
| `--endpoint <url>` | `http://localhost:11434` | Ollama API URL (local only) |
| `--hf-token <token>` | — | HuggingFace API token |

```bash
tl config connect --backend local --model translate-gemma-12b
tl config connect --backend huggingface --hf-token $HF_TOKEN
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
| `HF_TOKEN` | HuggingFace API token. Used when `adapter.backend` is `huggingface`. Overrides `adapter.huggingface.token` in config. |
| `TL_CONFIG` | Path to a custom config file. Overrides the default `~/.config/tl/config.jsonc`. |

Config values can also reference env vars directly:

```jsonc
{
  "adapter": {
    "huggingface": {
      "token": "${HF_TOKEN}"
    }
  }
}
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (adapter failure, glossary strict miss, config invalid, etc.) |

Error messages are printed to stderr with an actionable hint when available.
