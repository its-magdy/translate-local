# Context Guide

The context system indexes local files and retrieves relevant passages to include in translation prompts. This improves consistency when translating domain-specific content that has existing reference material.

## How It Works

1. You register one or more directories as context sources
2. `tl` walks the directory, reads supported files, and builds a TF-IDF index in SQLite
3. When translating, the pipeline tokenizes your source text and queries the index
4. The top-scoring snippets are included in the adapter prompt as reference material (each wrapped in `<reference>` tags, placed before the translate instruction so the model uses them without translating them)

The model uses these snippets to match tone, terminology, and style from your reference material.

## Supported File Types

`.txt`, `.md`, `.mdx`, `.rst`

Subdirectories are walked recursively. Symlinks to directories are not followed.

## CLI Usage

### Add a context source

```bash
tl context add ~/docs/legal-corpus
tl context add ~/projects/myapp/docs
```

The directory is indexed immediately on `add`. File content is stored (first 500 characters per file) along with TF-IDF scores for the top 100 terms per file.

### List context sources

```bash
tl context list
tl context list --json
```

Output includes path, number of indexed files, and when the source was last indexed.

### Re-index

```bash
tl context index
```

Run this after adding, removing, or editing files in a registered directory. The index is rebuilt from scratch for all sources.

### Remove a context source

```bash
tl context remove ~/docs/legal-corpus
```

Removes the source and all its indexed data from the database.

## How Snippets Feed Into Translation

The pipeline calls `ContextStore.retrieve(sourceText, limit)` which:

1. Tokenizes the source text (see [Tokenization](#tokenization))
2. Queries the index for files matching those tokens, ranked by sum of TF-IDF scores
3. Returns up to `limit` results (default: 5; the pipeline passes `context.maxSnippets` from config)

The retrieved snippets are passed to the adapter as `contextSnippets` in `TranslationRequest`.

## Tokenization

Indexing and retrieval share one Unicode-aware tokenizer, so it works for any script:

1. **Normalize**: NFKC (folds full-width / compatibility forms, e.g. `ＡＢＣ` → `ABC`), then locale-insensitive lowercase, then strip Arabic tashkeel and tatweel (`مُحَمَّد` → `محمد`), which are optional in normal writing.
2. **Chinese / Japanese / Korean** (Han, Hiragana, Katakana, Hangul runs): overlapping character bigrams — `机器学习` → `机器`, `器学`, `学习`. A run of a single character is kept as a unigram. This is the standard CJK approach in search engines (e.g. Lucene's `CJKAnalyzer`): it needs no dictionary and matches identically whether the phrase appears in a short query or a long document.
3. **Everything else** (Latin, Cyrillic, Arabic, Hebrew, Greek, Devanagari, Thai, …): words from `Intl.Segmenter` (`granularity: "word"`, Unicode UAX #29 boundaries; Thai/Lao/Khmer/Myanmar are dictionary-segmented). Words shorter than 3 characters are dropped to skip most function words (`is`, `of`, `في`, `на`).

### Upgrading from older versions

Indexed terms are stored in the context database. When the tokenizer changes, the database is rebuilt automatically the first time it is opened by the new version (tracked with SQLite `PRAGMA user_version`); large corpora may make that first command a few seconds slower. Sources whose directory no longer exists are left with no indexed terms — run `tl context index` to see the error, or remove them.

## Configuration

```jsonc
{
  "context": {
    "dbPath": "~/.config/tl/context.db",  // SQLite database location
    "maxSnippets": 3                        // Max snippets per translation
  }
}
```

## Context in file mode

`tl translate --file <path>` retrieves context per leaf, with the source value as the query. Each translated key gets its own up-to-`maxSnippets` snippets ranked by TF-IDF.

The tokenizer is Unicode-aware (see [Tokenization](#tokenization)), so Arabic, Cyrillic, CJK, and Thai source values retrieve context too. Values made only of words shorter than 3 characters (outside CJK) still yield no context — translation proceeds without it.

## Performance Notes

- Indexing is synchronous and happens in a single transaction per source
- Large corpora (thousands of files) take a few seconds on first `add` or `index`
- Only the top 100 TF-IDF terms per file are stored — retrieval is fast even for large corpora
- The context database (`~/.config/tl/context.db`) grows with your corpus; delete and re-add sources to reclaim space

## File Paths

| File | Default Location |
|------|-----------------|
| Context SQLite database | `~/.config/tl/context.db` |
