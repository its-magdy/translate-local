# @translate-local/tl

`tl` is a CLI-first translation tool that enforces glossary terms, pulls context from your own documents, and runs on a local model via [Ollama](https://ollama.com) — no translation API, no text leaving your machine.

This package installs the prebuilt `tl` binary for your platform.

## Install

```sh
npm install -g @translate-local/tl
# or
bun add -g @translate-local/tl
# or run without installing
bunx @translate-local/tl "hello" --to ar
```

Then pull the default model once:

```sh
ollama pull translategemma:latest
```

## Use

```sh
tl "good morning" --to ar            # translate text
tl translate --image sign.jpg --to ar # translate text in an image
tl translate --file en.json --to ar   # translate a JSON/YAML i18n catalog
tl                                    # interactive TUI
```

Full documentation: https://github.com/its-magdy/translate-local

MIT licensed.
