# tl Translate — Raycast Extension

Local-first translation with glossary enforcement, powered by tl + Ollama. No data leaves your machine.

## Prerequisites

1. **macOS** with [Raycast](https://raycast.com) installed
2. **Ollama** — install from [ollama.com](https://ollama.com), then pull the model:
   ```bash
   ollama pull translate-gemma-12b
   ```
3. **tl CLI** — install from source:
   ```bash
   git clone https://github.com/its-magdy/tl
   cd tl && bun install && bun run build
   ```
   Then add to your PATH or link globally.

## Install the Extension

### From Raycast Store (coming soon)

Search "tl Translate" in Raycast.

### Manual Install

```bash
git clone https://github.com/its-magdy/tl
cd tl/apps/raycast
npm install
npm run build
```

Then open Raycast → **Import Extension** → select the `apps/raycast/` folder.

## Commands

| Command | Description | Mode |
|---------|-------------|------|
| Translate Text | Form-based translation with language & glossary options | View |
| Translate Selection | Translate highlighted text and paste result in place | No-view (hotkey) |
| Translate Clipboard | Translate clipboard contents and copy result | No-view (hotkey) |
| Manage Glossary | Browse, search, and delete glossary entries | View |
| Add Glossary Entry | Add a new source→target term pair | View |

## Preferences

Configure in Raycast → Extensions → tl Translate → Preferences:

- **tl Binary Path** — path to `tl` CLI (default: `tl`)
- **Default Target Language** — language to translate into by default
- **Glossary Mode** — `prefer` (suggest terms) or `strict` (require terms)

## Development

```bash
cd apps/raycast
npm install
npm run dev      # Loads in Raycast dev mode
npm test         # Run unit tests
npm run lint     # Lint check
```

> **Note:** This extension uses npm (not bun) because Raycast's runtime requires it.
