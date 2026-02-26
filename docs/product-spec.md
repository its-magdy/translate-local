# `tl` — Product Specification

## Summary

`tl` is an open-source translation tool with a CLI-first workflow, optional TUI for interactive translation and glossary management, and a pluggable model adapter layer. Default model is TranslateGemma via Ollama (local) or HuggingFace API. The system emphasizes glossary enforcement, contextual translation from local resources, and automatic memory management (model unloading after use).

## Goals (v1)

1. Ship a usable CLI for interactive translation with glossary control
2. Provide an optional TUI for review/edit workflows
3. Support a model adapter interface with TranslateGemma as default and mock adapter for tests
4. Allow local resources (glossaries, style guides, domain docs) to be indexed and injected as context
5. Keep a clean path to add APIs/web later without rework

## Non-Goals (v1)

- Multi-tenant SaaS hosting or billing
- Full localization pipeline for i18n resource files (`.po`, `.xliff`, etc.)
- Large-scale document translation orchestration
- Embedding-based semantic search (v1 uses keyword/TF-IDF)

## What is a Glossary?

A glossary is a curated list of source-term → target-term mappings that must be used consistently in translations. Examples:

| Source (EN) | Target (AR) | Domain |
|---|---|---|
| API | واجهة برمجة التطبيقات | Technical |
| Sign in | تسجيل الدخول | UI/Brand |
| Cloud | سحابة | Technical |
| Repository | مستودع | Technical |

**Why it matters:**
- Without glossaries, AI models tlfreely and may use different words for the same concept
- Critical for: technical docs, legal/medical content, brand consistency, UI labels

**Two modes:**
- `prefer` (default): best-effort glossary use, warns on misses
- `strict`: retries translation if a glossary term is missing from output

## User Workflows

### 1. Quick Translation
```bash
tl "Hello world" --to ar
# Output: مرحبا بالعالم
```

### 2. Translation with Glossary
```bash
# Add terms
tl glossary add --source "API" --target "واجهة برمجة" --from en --to ar
tl glossary add --source "Cloud" --target "سحابة" --from en --to ar

# Translate with glossary enforcement
tl "The API runs in the Cloud" --to ar --glossary=strict
# Output: واجهة برمجة تعمل في السحابة
# Glossary: 2/2 terms enforced ✓
```

### 3. Bulk Glossary Import
```bash
tl glossary import terms.csv --from en --to ar
tl glossary list
```

### 4. Context-Aware Translation
```bash
# Index domain docs for context
tl context add ./docs/medical-terminology/
tl context index

# Translate with domain context
tl "The patient presented with acute dyspnea" --to ar
# Context from medical-terminology/ injected into prompt
```

### 5. Interactive TUI
```bash
tl
# No arguments → launches TUI
# Side-by-side source/target view
# Glossary status panel
# Edit translations inline
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `tl <text>` | Translate text. Flags: `--from`, `--to`, `--glossary=prefer\|strict`, `--model`, `--json` |
| `tl glossary add` | Add a glossary entry: `--source`, `--target`, `--from`, `--to`, `--domain`, `--note` |
| `tl glossary list` | List entries. Filter: `--from`, `--to`, `--domain` |
| `tl glossary remove` | Remove by ID or term |
| `tl glossary import <file>` | Import from CSV or JSON |
| `tl glossary export` | Export to CSV or JSON |
| `tl context add <path>` | Add local doc directory as context source |
| `tl context list` | List indexed sources |
| `tl context remove <path>` | Remove a context source |
| `tl context index` | Re-index all context sources |
| `tl config connect` | Configure adapter (model, backend, credentials) |
| `tl config status` | Show current config and test adapter |
| `tl` (no args) | Launch interactive terminal UI |

## Data Models

### Glossary Entry
```typescript
{
  id: string;
  sourceTerm: string;      // e.g. "API"
  targetTerm: string;      // e.g. "واجهة برمجة"
  sourceLang: string;      // BCP-47, e.g. "en"
  targetLang: string;      // BCP-47, e.g. "ar"
  domain?: string;         // e.g. "medical", "legal", "ui"
  note?: string;           // usage notes
}
```

### Translation Request
```typescript
{
  source: string;
  sourceLang: string;
  targetLang: string;
  glossaryHits?: GlossaryHit[];    // pre-matched terms
  contextSnippets?: string[];       // domain context
  options?: {
    formality?: "formal" | "informal";
    glossaryMode?: "strict" | "prefer";
  };
}
```

### Translation Result
```typescript
{
  translated: string;
  sourceLang: string;
  targetLang: string;
  glossaryCoverage: number;     // 0-1
  missingTerms: string[];       // glossary terms not found in output
  metadata: {
    adapter: string;
    durationMs: number;
    retries: number;
  };
}
```

## Supported Adapters (v1)

1. **TranslateGemma (local)** — via Ollama subprocess
2. **TranslateGemma (HuggingFace)** — via HF Inference API
3. **Mock** — deterministic output for tests

Future: any OpenAI-compatible API, Anthropic, Google Vertex, etc.

## Assumptions

- Open-source tool, user provides their own model/credentials
- CLI-first, TUI is optional enhancement
- Glossary default mode is `prefer`
- SQLite for glossary and context storage (zero dependencies with bun:sqlite)
- No embedding models in v1, keyword/TF-IDF for context retrieval
