# Glossary Guide

The glossary is a database of term pairs that `tl` enforces during translation. When a source term is found in your text, the pipeline injects an XML tag that instructs the model to use the specified target translation.

## How It Works

When translating, the pipeline:

1. Looks up glossary entries matching the source language and target language (with [language fallback](#language-code-fallback))
2. Finds occurrences of source terms in your text ([Unicode-aware matching](#term-matching), case-insensitive)
3. Injects XML tags: `<term translation="target">source</term>`
4. Sends the tagged text to the adapter
5. Validates that target terms appear in the output (substring check, see [Coverage check](#coverage-check))
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

Duplicate entries (same source, target, source_lang, target_lang) are silently skipped. The whole file is imported in a single transaction — if the import fails partway, no rows are written.

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

## Glossary in file mode

`tl translate --file <path>` applies the glossary per leaf, exactly like single-string translation. The same `--glossary prefer|strict` flag governs both modes. Strict mode causes per-key retries when terms are missing; if all retries fail on a key, the default behavior records the failure and falls back to the source value (pass `--strict` to abort the whole run instead).

In a typical file translation of N keys, glossary matching runs N times. Each match is fast (indexed SQLite query in-process), but for very large catalogs you may notice the cumulative cost. This is acceptable for v1; revisit if it becomes a bottleneck.

## Term matching

Source terms are matched case-insensitively. How a term's edges are anchored depends on the script of the character at that edge:

- **Space-delimited scripts** (Latin incl. accented letters, Cyrillic, Greek, Arabic, Hebrew, Hangul, Devanagari, …): whole-word match. The neighbouring character must not be a letter, digit, combining mark, or `_` of a space-delimited script. `café` matches in `un café noir` but not in `cafés`; `caf` does not match inside `café`.
- **Scripts without word spaces** (Chinese, Japanese kanji/kana, Thai, Lao, Khmer, Myanmar): substring match. `机器学习` matches in `我喜欢机器学习技术`, and `東京タワー` matches in `東京タワーに行く`.
- **Punctuation at an edge** (e.g. `C++`, `(beta)`): that edge is not anchored. Regex metacharacters in terms are always matched literally.

A neighbour from a no-space script never blocks a match, so `API` matches in `このAPIキーを使う`.

Substring matching for CJK/Thai was chosen over `Intl.Segmenter` (which Bun supports): dictionary segmentation splits text by ICU's lexicon, which need not agree with your entries (e.g. it splits `机器学习` into `机器|学习`), and results can change between ICU versions. Substring matching is deterministic and what CAT tools commonly do for these scripts. The tradeoff is that a short CJK term can match inside a longer compound; longer entries win over shorter overlapping ones, so add the compound as its own entry if needed.

**Attached prefixes and particles are not stripped.** In Arabic, `كتاب` does not match inside `الكتاب`, `وكتاب`, or `بكتاب`; in Korean, `서울` does not match inside `서울에서`. Add the forms you need as separate entries. This keeps matches on whole words, so the injected `<term>` tag never splits a word.

## Language code fallback

Language codes are matched case-insensitively (`en-us` == `en-US`) and fall back along the BCP-47 lookup chain ([RFC 4647 §3.4](https://www.rfc-editor.org/rfc/rfc4647#section-3.4)) on both the source and target side:

- `en-US` → `en`
- `zh-Hant-TW` → `zh-Hant` → `zh`

So `tl "..." --from en-US --to fr-CA` uses entries stored under `en`/`fr`, `en-US`/`fr`, `en`/`fr-CA`, and `en-US`/`fr-CA`. Fallback only goes toward the base: translating from `en` does **not** use entries stored under `en-US`.

When the same source term has entries at several levels, the most specific wins (counted in matched subtags, source plus target). With `email → e-mail` under `en`/`fr` and `email → courriel` under `en`/`fr-CA`, `--to fr-CA` uses `courriel` and `--to fr-FR` uses `e-mail`.

`tl glossary list --from/--to` still filters by the exact stored code.

## Coverage check

After translation, a glossary term counts as covered if its target term appears anywhere in the output (ignoring combining diacritics). This is a substring check on purpose: models inflect target terms (Arabic `الكتاب` for `كتاب`, Russian `компьютера` for `компьютер`, Japanese terms followed by particles), and a whole-word check would report those as missing and trigger needless retries in `strict` mode. The flip side is that a target term contained in a longer word also counts as covered.
