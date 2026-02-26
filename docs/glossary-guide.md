# Glossary Guide

The glossary is a database of term pairs that `tl` enforces during translation. When a source term is found in your text, the pipeline injects an XML tag that instructs the model to use the specified target translation.

## How It Works

When translating, the pipeline:

1. Looks up glossary entries matching the source language and target language
2. Finds occurrences of source terms in your text (word-boundary matching, case-insensitive)
3. Injects XML tags: `<term translation="target">source</term>`
4. Sends the tagged text to the adapter
5. Validates that target terms appear in the output
6. Strips the XML tags from the final result

## Enforcement Modes

Set via `--glossary <mode>` flag or `glossary.mode` in config.

### `prefer` (default)

The model is guided toward using the specified translations, but the result is returned even if some terms are missing. No retries.

```bash
tl "machine learning model" --from en --to ar --glossary prefer
```

### `strict`

If any glossary terms are missing from the translation, the pipeline retries (up to `glossary.maxRetries` times, default 2). Each retry appends a hint to the prompt listing the missing terms. If they are still missing after all retries, the command exits with error code 1.

```bash
tl "machine learning model" --from en --to ar --glossary strict
```

Use `strict` for legal, medical, or technical content where term accuracy is non-negotiable.

## CSV Import Format

```
source,target,from,to,domain,note
machine learning,تعلم الآلة,en,ar,tech,
neural network,شبكة عصبية,en,ar,tech,
bonjour,hello,fr,en,,informal greeting
```

Columns:
- `source` — source term (required)
- `target` — target translation (required)
- `from` — BCP-47 source language code (required)
- `to` — BCP-47 target language code (required)
- `domain` — optional domain label
- `note` — optional free-text note

Import:

```bash
tl glossary import ./terms.csv
```

Duplicate entries (same source, target, source_lang, target_lang) are silently skipped.

## CRUD via CLI

### Add a term

```bash
tl glossary add \
  --source "API" \
  --target "واجهة برمجية" \
  --from en \
  --to ar \
  --domain tech
```

### List terms

```bash
tl glossary list                    # all entries
tl glossary list --from en --to ar  # filtered
tl glossary list --json             # JSON output
```

### Remove a term

```bash
# Get the ID from list output
tl glossary list --json | jq '.[0].id'

tl glossary remove <id>
```

### Export

```bash
tl glossary export --from en --to ar > my-glossary.csv
tl glossary export --json
```

## File Paths

| File | Default Location |
|------|-----------------|
| Glossary SQLite database | `~/.config/tl/glossary.db` |
| Config file | `~/.config/tl/config.jsonc` |

Override the database path in config:

```jsonc
{
  "glossary": {
    "dbPath": "~/my-project/glossary.db"
  }
}
```

## Limitations

- Word-boundary matching uses `\b`, which works on ASCII Latin characters. For CJK, Arabic, or other non-Latin source terms, boundaries may not match as expected. Workaround: ensure the source text contains spaces around the term.
- Glossary lookup is by exact language code. `en-US` and `en` are treated as different languages.
