# Context Guide

The context system indexes local files and retrieves relevant passages to include in translation prompts. This improves consistency when translating domain-specific content that has existing reference material.

## How It Works

1. You register one or more directories as context sources
2. `tl` walks the directory, reads supported files, and builds a TF-IDF index in SQLite
3. When translating, the pipeline tokenizes your source text and queries the index
4. The top-scoring snippets are included in the adapter prompt under a "Context:" section

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

1. Tokenizes the source text into 3+ character alphanumeric tokens
2. Queries the index for files matching those tokens, ranked by sum of TF-IDF scores
3. Returns up to `limit` results (default: 5; the pipeline passes `context.maxSnippets` from config)

The retrieved snippets are passed to the adapter as `contextSnippets` in `TranslationRequest`.

## Configuration

```jsonc
{
  "context": {
    "dbPath": "~/.config/tl/context.db",  // SQLite database location
    "maxSnippets": 3                        // Max snippets per translation
  }
}
```

## Performance Notes

- Indexing is synchronous and happens in a single transaction per source
- Large corpora (thousands of files) take a few seconds on first `add` or `index`
- Only the top 100 TF-IDF terms per file are stored — retrieval is fast even for large corpora
- The context database (`~/.config/tl/context.db`) grows with your corpus; delete and re-add sources to reclaim space

## File Paths

| File | Default Location |
|------|-----------------|
| Context SQLite database | `~/.config/tl/context.db` |
