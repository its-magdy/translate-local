# tl

> A CLI-first translation tool that enforces glossary terms, pulls context from local files, and runs on a local model — no translation API required.

Most translation tools are black boxes: you send text, you get text back, and you hope your domain-specific terminology survived. `tl` is different. It lets you define term pairs that the model must respect, index your own documents as context, and run everything locally via Ollama — without sending your text to any external service.

---

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
  - [Translate text](#translate-text)
  - [Glossary](#glossary)
  - [Context sources](#context-sources)
  - [Config](#config)
  - [Interactive TUI](#interactive-tui)
- [Command reference](#command-reference)
- [Running tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)

---

## Prerequisites

- [Ollama](https://ollama.com) with `translate-gemma-12b` pulled
- (Contributors only) [Bun](https://bun.sh) ≥ 1.3

## Installation

`tl` ships as a self-contained binary — no Bun, Node, or other runtime needed. Pick the install method for your platform.

### npm / bun

If you have Bun or Node installed, this is the easiest path:

```sh
# Install globally — then just type `tl`
bun install -g @translate-local/tl
# or
npm install -g @translate-local/tl

# Run without installing (one-off)
bunx @translate-local/tl "hello" --to ar
npx @translate-local/tl "hello" --to ar
```

Only the binary for your platform is downloaded (~63 MB). No Bun or Node runtime needed after install.

### Direct binary download

Download for your platform from the [latest release](https://github.com/its-magdy/translate-local/releases/latest). The snippets below install to `~/.local/bin` — no `sudo` required. Make sure `~/.local/bin` is on your `PATH` (add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile if it isn't):

```bash
mkdir -p ~/.local/bin

# macOS — Apple Silicon
curl -L https://github.com/its-magdy/translate-local/releases/latest/download/tl-darwin-arm64 -o ~/.local/bin/tl
chmod +x ~/.local/bin/tl
xattr -d com.apple.quarantine ~/.local/bin/tl   # macOS only — required until we ship signed builds

# macOS — Intel
curl -L https://github.com/its-magdy/translate-local/releases/latest/download/tl-darwin-x64 -o ~/.local/bin/tl
chmod +x ~/.local/bin/tl
xattr -d com.apple.quarantine ~/.local/bin/tl

# Linux — x64
curl -L https://github.com/its-magdy/translate-local/releases/latest/download/tl-linux-x64 -o ~/.local/bin/tl
chmod +x ~/.local/bin/tl

# Linux — ARM64
curl -L https://github.com/its-magdy/translate-local/releases/latest/download/tl-linux-arm64 -o ~/.local/bin/tl
chmod +x ~/.local/bin/tl
```

To install system-wide instead, replace `~/.local/bin` with `/usr/local/bin` and prefix each `curl`/`chmod`/`xattr` with `sudo`.

For Windows, download `tl-windows-x64.exe` from the release page and place it on your `PATH`.

The binary is ~63 MB and self-contained. Verify the download with the `SHA256SUMS` file from the same release.

### Develop / contribute to tl

This is the **contributor** workflow — `bun link` symlinks `tl` to your working copy of the source. If you delete or move the cloned folder, `tl` breaks. End users should use the binary download above.

```bash
git clone https://github.com/its-magdy/translate-local.git
cd translate-local
bun install
cd apps/cli && bun link
```

To build a release-style binary locally:

```bash
cd apps/cli && bun run build:bin
./dist/tl --version
```

To uninstall the dev link later, remove the symlink Bun created in `~/.bun/bin`:

```bash
rm "$(which tl)"
```

## Setup

```bash
ollama pull translate-gemma-12b
tl config connect --model translate-gemma-12b
```

---

## Usage

### Translate text

Translate a string with automatic language detection:

```bash
tl "good morning" --to ar
```

Specify source and target explicitly:

```bash
tl "good morning" --from en --to ar
```

`tl translate` is the explicit form — these two are equivalent:

```bash
tl "hello world" --from en --to es
tl translate "hello world" --from en --to es
```

#### Image translation

TranslateGemma supports vision input. Pass `--image` with a path to extract and translate text from an image:

```bash
tl translate --image /path/to/sign.jpg --to ar
tl translate --image /path/to/menu.png --from en --to es --glossary strict
tl translate --image /path/to/doc.jpg --to fr --json
```

Get machine-readable output:

```bash
tl "hello" --from en --to ar --json
```

```json
{
  "translated": "مرحبا",
  "sourceLang": "en",
  "targetLang": "ar",
  "glossaryCoverage": 1.0,
  "missingTerms": [],
  "metadata": { "adapter": "translate-gemma-local", "durationMs": 312, "retries": 0 }
}
```

#### Glossary mode

`--glossary prefer` (default) guides the model toward your term pairs but returns the result regardless.

`--glossary strict` retries up to 2 times if any glossary term is missing, then exits with code 1:

```bash
tl "neural network training" --from en --to ar --glossary strict
```

---

### Glossary

The glossary is a local SQLite database of term pairs. During translation, matched terms are injected as XML tags so the model knows exactly which target word to use.

**Add a term:**

```bash
tl glossary add \
  --source "machine learning" \
  --target "تعلم الآلة" \
  --from en \
  --to ar \
  --domain tech
```

**List terms:**

```bash
tl glossary list --from en --to ar
```

**Import from CSV:**

```bash
tl glossary import ./terms.csv
```

CSV format: `source,target,from,to,domain,note`

**Export:**

```bash
tl glossary export --from en --to ar > backup.csv
```

**Remove by ID:**

```bash
tl glossary remove <id>   # ID shown in: tl glossary list --json
```

See [docs/glossary-guide.md](docs/glossary-guide.md) for the full reference.

---

### Context sources

Index local `.md`, `.txt`, `.mdx`, or `.rst` files. On each translation, the most relevant passages are retrieved via TF-IDF and added to the prompt.

**Add a directory:**

```bash
tl context add ~/docs/legal-corpus
```

The directory is indexed immediately.

**List sources:**

```bash
tl context list
```

```
~/docs/legal-corpus   42 files   indexed 2025-01-15T10:30:00Z
```

**Re-index after file changes:**

```bash
tl context index
```

**Remove a source:**

```bash
tl context remove ~/docs/legal-corpus
```

See [docs/context-guide.md](docs/context-guide.md) for retrieval tuning options.

---

### Config

```bash
tl config status          # show current config and adapter health
tl config path            # print config file location
tl config connect [...]   # set adapter backend
```

---

### Interactive TUI

Run `tl` with no arguments:

```bash
tl
```

The terminal UI opens with a **Translate** tab (side-by-side source/target panes) and a **Glossary** tab for managing term pairs. It supports image translation via drag-and-drop or pasting an image path into the source pane.

See [docs/tui-guide.md](docs/tui-guide.md) for the full reference.

---

## Command reference

| Command | Description |
|---------|-------------|
| `tl <text>` | Translate text (shorthand for `tl translate`) |
| `tl translate <text>` | Translate with explicit subcommand |
| `tl translate --image <path>` | Extract and translate text from an image |
| `tl glossary add` | Add a glossary term pair |
| `tl glossary list` | List glossary entries |
| `tl glossary remove <id>` | Remove an entry by ID |
| `tl glossary import <file>` | Import term pairs from CSV |
| `tl glossary export` | Export glossary to CSV or JSON |
| `tl context add <path>` | Register and index a directory |
| `tl context list` | List registered context sources |
| `tl context remove <path>` | Remove a context source |
| `tl context index` | Re-index all context sources |
| `tl config connect` | Configure the adapter backend |
| `tl config status` | Show config and test the adapter |
| `tl config path` | Print config file path |

**Shared flags for `tl translate`:**

| Flag | Default | Description |
|------|---------|-------------|
| `--from <lang>` | `auto` | Source language (BCP-47) |
| `--to <lang>` | `ar` | Target language (BCP-47) |
| `--glossary <mode>` | `prefer` | `prefer` or `strict` |
| `--json` | off | Output JSON |

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `TL_CONFIG` | Path to a custom config file |

**Exit codes:** `0` = success, `1` = error.

**Docs:**
- [docs/cli-reference.md](docs/cli-reference.md) — full CLI flag reference
- [docs/tui-guide.md](docs/tui-guide.md) — TUI usage and keybindings
- [docs/glossary-guide.md](docs/glossary-guide.md) — glossary CSV format and advanced usage
- [docs/context-guide.md](docs/context-guide.md) — context retrieval tuning
- [docs/adapter-development.md](docs/adapter-development.md) — building custom adapters

---

## Running tests

```bash
# Unit tests
bun run test

# Integration tests (pipeline + SQLite)
TEST_INTEGRATION=1 bun run test

# Adapter tests (requires Ollama)
TEST_ADAPTER=1 bun run test
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, branch strategy, and the pre-commit checklist.

---

## License

MIT — see [LICENSE](LICENSE).
