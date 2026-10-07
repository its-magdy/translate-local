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

The directory is indexed immediately on `add`. File content is stored (first 500 characters per file) along with TF-IDF scores for each file's top terms (300, plus one per Chinese/Japanese/Korean bigram, up to 1,000).

Subfolders that can't be read (for example, permission denied) are skipped with a warning, and the rest is indexed. If the folder itself can't be read, nothing is added, and re-adding an existing path that fails keeps the previous index. `tl context index` skips unreadable subfolders the same way.

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

1. **Normalize**: NFKC (folds full-width / compatibility forms, e.g. `ＡＢＣ` → `ABC`), then locale-insensitive lowercase, then strip marks that are optional in normal writing: Arabic tashkeel and tatweel (`مُحَمَّد` → `محمد`) and Hebrew niqqud (`שָׁלוֹם` → `שלום`). Arabic hamza-on-alef forms fold to bare alef (`أ إ آ` → `ا`), and Arabic-Indic / Persian digits become ASCII (`٢٠٢٤` → `2024`).
2. **Chinese / Japanese / Korean** (Han, Hiragana, Katakana, Hangul runs): overlapping character bigrams — `机器学习` → `机器`, `器学`, `学习`. A run of a single character is kept as a unigram. This is the standard CJK approach in search engines (e.g. Lucene's `CJKAnalyzer`): it needs no dictionary and matches identically whether the phrase appears in a short query or a long document.
3. **Everything else** (Latin, Cyrillic, Arabic, Hebrew, Greek, Devanagari, Thai, …): words from `Intl.Segmenter` (`granularity: "word"`, Unicode UAX #29 boundaries; Thai/Lao/Khmer/Myanmar are dictionary-segmented). Words shorter than 3 characters are dropped to skip most function words (`is`, `of`, `في`, `на`).

### Upgrading from older versions

Indexed terms are stored in the context database, and each source records the index version it was built with. When a new release changes tokenization or scoring, the first command that opens the database rebuilds every out-of-date source. That command takes about as long as `tl context index` (it scales with corpus size: about 2–5 s for 1,000 Markdown files / 12 MB on a laptop) and runs once.

- The rebuild runs in a single transaction. If several `tl` processes start at once, the others wait for it to finish (up to 30 s) instead of failing, and a crash partway through leaves the previous index intact.
- A source that can't be re-indexed (missing or unreadable folder, unmounted drive, any other file error) keeps its previous index and is retried on a later open, without blocking the command. Checking for that is read-only, so a missing folder doesn't make every command take a write lock. Use `tl context remove` if the folder is gone for good. Unreadable subfolders are skipped, as with `tl context add`.
- A read-only database is not migrated. It keeps serving its previous index.
- **The upgrade is one-way.** Older releases (0.4.2 and earlier) can't read a migrated database: every `tl translate` fails with `no such column: source_id`. To go back to an older release, delete the context database (`~/.config/tl/context.db` by default) and run `tl context add` again for each source. `tl context list --json` on the new version prints the paths.

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
- Only each file's top 300–1,000 TF-IDF terms are stored, and a term lookup is a primary-key seek (see [Index size](#index-size))
- The context database (`~/.config/tl/context.db`) grows with your corpus; delete and re-add sources to reclaim space

### Index size

**Layout.** Each file gets an integer id in `context_docs`. `context_terms` stores `(term, doc_id, weight)` as a `WITHOUT ROWID` table keyed on `(term, doc_id)`, so looking up a query term is a seek on the primary key, and the source id and file path aren't repeated on every term row.

**How many terms are kept.** CJK text is indexed as character bigrams, so a Chinese document has about as many distinct terms as characters. Each file keeps its top **300 terms plus one per distinct CJK bigram, up to 1,000**:
- English recall stopped improving at 300 (first table below).
- A Chinese document keeps every term up to about 1,000–1,500 characters. (The original cap of 100 left only the first ~100 characters searchable.)

Measured on 1,000 real English Markdown files (12 MB) and 300 Chinese documents of ~2,900 characters each. First, choosing a flat cap under the previous layout:

| Terms kept per file | English DB | Chinese DB | English tail recall@3 |
|---|---|---|---|
| 100 | 30 MB | 8 MB | 42/100 |
| 300 | 67 MB | 23 MB | 50/100 |
| 1,000 | 93 MB | 76 MB | 50/100 |
| unlimited | 97 MB | 118 MB | 50/100 |

Then the previous layout with a flat 1,000 against the current layout and cap, in two runs on a busy laptop:

| | English DB | English index | English query | Chinese DB | Chinese index | Chinese query | English tail recall@3 |
|---|---|---|---|---|---|---|---|
| previous (flat 1,000) | 93 MB | 2.5–8.0 s | 63–75 ms | 76 MB | 1.4–1.6 s | 42–47 ms | 50/100 |
| current | **7.2 MB** | 1.5–1.8 s | **0.6–0.8 ms** | **8.2 MB** | 0.9 s | **0.4–0.5 ms** | 50/100 |

"Tail recall" is how often a query built from a file's last sentence returns that file in the top 3.
- The previous layout's lookup index started with `source_id`, which retrieval doesn't filter on, so every query scanned the whole term table.
- Most of the previous size came from repeating the full file path on every term row, and again in the index.
- The Chinese documents are synthetic random text: in 91 of 100 queries the 3rd and 4th results tie, so recall there reflects tie order and isn't a quality measure.

## File Paths

| File | Default Location |
|------|-----------------|
| Context SQLite database | `~/.config/tl/context.db` |
