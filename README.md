# tl

A CLI-first translation tool with glossary enforcement, context-aware translation, and a pluggable adapter architecture. Works locally via Ollama or in the cloud via HuggingFace.

```
tl "hello world" --from en --to ar
```

## Features

- **Glossary enforcement** — import term pairs; translations respect them in `prefer` or `strict` mode
- **Context-aware** — index local `.md`/`.txt`/`.rst` files; relevant snippets feed into every translation
- **Interactive TUI** — run `tl` with no arguments to launch the terminal UI
- **Pluggable adapters** — local Ollama or HuggingFace API; add your own in minutes
- **Zero-build dev** — Bun runs TypeScript sources directly; no compile step needed

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- One of:
  - [Ollama](https://ollama.com) running locally with `translate-gemma-12b` pulled
  - A HuggingFace API token with access to `google/translategemma-12b-it`

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/tl.git
cd tl
bun install

# 2. (Local) Pull the model
ollama pull translate-gemma-12b

# 3. (HuggingFace) Set your token
export HF_TOKEN=hf_...

# 4. Translate
bun run apps/cli/src/index.ts "good morning" --from en --to ar
```

Once you link or build the binary, the shorthand is just:

```bash
tl "good morning" --from en --to ar
```

## Configuration

Config lives at `~/.config/tl/config.jsonc`. Generate it with:

```bash
tl config connect --backend local --model translate-gemma-12b
```

Or for HuggingFace:

```bash
tl config connect --backend huggingface --hf-token $HF_TOKEN
```

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/cli-reference.md](docs/cli-reference.md) | All commands, flags, env vars, exit codes |
| [docs/glossary-guide.md](docs/glossary-guide.md) | Managing term pairs, CSV import, strict vs prefer modes |
| [docs/context-guide.md](docs/context-guide.md) | Indexing local files for context-aware translation |
| [docs/adapter-development.md](docs/adapter-development.md) | Building and registering custom adapters |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Architecture, pipeline flow, config schema |
| [docs/product-spec.md](docs/product-spec.md) | Data models and user workflows |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, branch strategy, PR checklist |

## Project Structure

```
t/
├── packages/shared/     # Types, errors, constants, utils
├── packages/core/       # Config, glossary, pipeline, context
├── packages/adapters/   # TranslateGemma (local/HF), mock
├── apps/cli/            # Commander.js CLI (tl command)
└── apps/tui/            # Interactive terminal UI
```

## License

MIT
