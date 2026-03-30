# tl Translate - Raycast Extension

Local-first translation with glossary enforcement via the `tl` CLI and Ollama.

## Prerequisites

- macOS with [Raycast](https://raycast.com) installed
- [tl CLI](../../) installed and on your PATH
- [Ollama](https://ollama.ai) running with TranslateGemma model

## Development

```bash
npm install
npm run dev
```

This opens the extension in Raycast's development mode.

## Testing

```bash
npm test
```

## Commands

| Command | Description |
|---|---|
| **Translate Text** | Translate text with language and glossary options |
| **Translate Selection** | Translate selected text and paste the result |
| **Translate Clipboard** | Translate clipboard contents |
| **Manage Glossary** | View and manage glossary entries |
| **Add Glossary Entry** | Add a new glossary term pair |

## Preferences

- **tl Binary Path** - Path to the `tl` CLI (default: `tl`)
- **Default Target Language** - Language to translate into by default
- **Glossary Mode** - `prefer` (suggest terms) or `strict` (require terms)
