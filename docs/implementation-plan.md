# `tl` — Implementation Plan

## Architecture

Monorepo (Bun + Turborepo + TypeScript):

```
t/
├── package.json              # workspace root
├── turbo.json                # turborepo pipeline
├── tsconfig.base.json        # shared TS config
├── packages/
│   ├── shared/               # Types, errors, constants
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   ├── adapter.ts        # ModelAdapter interface
│   │       │   ├── translation.ts    # TranslationRequest, TranslationResult
│   │       │   ├── glossary.ts       # GlossaryEntry, GlossaryStore, GlossaryHit
│   │       │   ├── context.ts        # ContextProvider, ContextSnippet
│   │       │   └── config.ts         # AppConfig type
│   │       ├── errors.ts             # TaggedError with hints
│   │       ├── constants.ts          # supported languages, defaults
│   │       └── utils/
│   │           ├── language.ts        # BCP-47 helpers
│   │           └── text.ts            # tag injection/stripping
│   ├── core/                 # Business logic
│   │   └── src/
│   │       ├── pipeline/
│   │       │   ├── pipeline.ts        # Orchestrator
│   │       │   ├── preprocess.ts      # Glossary detection + tag injection
│   │       │   ├── validate.ts        # Glossary coverage check + retry
│   │       │   └── postprocess.ts     # Tag cleanup + normalization
│   │       ├── glossary/
│   │       │   ├── store.ts           # SQLite CRUD (bun:sqlite)
│   │       │   └── matcher.ts         # Term matching in source text
│   │       ├── context/
│   │       │   ├── provider.ts        # ContextProvider impl
│   │       │   └── indexer.ts         # TF-IDF indexer in SQLite
│   │       └── config/
│   │           ├── manager.ts         # Load/save/validate config
│   │           └── schema.ts          # Zod schema
│   └── adapters/             # Model implementations
│       └── src/
│           ├── index.ts
│           ├── factory.ts            # createAdapter(config)
│           ├── base.ts               # Shared adapter logic
│           ├── translate-gemma/
│           │   └── local.ts          # Ollama subprocess
│           └── mock.ts               # Deterministic mock
└── apps/
    ├── cli/                  # CLI application
    │   └── src/
    │       ├── index.ts              # Commander.js entry
    │       ├── commands/
    │       │   ├── translate.ts
    │       │   ├── glossary.ts       # add/list/remove/import/export
    │       │   ├── context.ts        # add/list/remove/index
    │       │   └── config.ts         # connect/status
    │       └── formatters/
    │           └── output.ts         # table, json, plain
    └── tui/                  # Terminal UI (Phase 6)
        └── src/
            ├── index.ts
            └── views/
                ├── translate.ts      # Side-by-side view
                └── glossary.ts       # Glossary manager
```

## Translation Pipeline Flow

```
1. Preprocess
   ├── Detect language if "auto"
   ├── glossaryStore.findMatches(text, src, tgt) → GlossaryHit[]
   └── Wrap matched terms: "The <term tgt="واجهة برمجة">API</term> is..."

2. Context Retrieval
   └── contextProvider.retrieve(text, limit=3) → ContextSnippet[]

3. Build Prompt
   └── System prompt + tagged source text + context snippets

4. Translate
   └── adapter.translate(request) → raw result

5. Validate
   ├── Check each glossary term appears in output
   ├── If strict + missing + retries < max → rebuild prompt with hint, goto step 4
   └── Compute glossaryCoverage (0-1)

6. Postprocess
   ├── Strip remaining XML tags
   └── Normalize whitespace/punctuation
```

## Config File

Location: `~/.config/tl/config.jsonc`

```jsonc
{
  "adapter": {
    "type": "translate-gemma",
    "backend": "local",
    "local": {
      "command": "ollama",
      "model": "translate-gemma-12b",
      "endpoint": "http://localhost:11434",
      "keepAlive": false
    },
  },
  "glossary": {
    "mode": "prefer",
    "maxRetries": 2,
    "dbPath": "~/.config/tl/glossary.db"
  },
  "context": {
    "dbPath": "~/.config/tl/context.db",
    "maxSnippets": 3,
    "minRelevance": 0.3
  },
  "defaults": {
    "sourceLang": "auto",
    "targetLang": "ar"
  }
}
```

## Memory Management

Every adapter implements `dispose()` for cleanup:
- **TranslateGemma local (Ollama)**: sends `POST /api/generate` with `keep_alive: 0` to unload model from VRAM
- **Mock**: no-op

Behavior:
- CLI: pipeline calls `dispose()` after each translation when `keepAlive: false` (default)
- TUI: registers `SIGINT`/`SIGTERM` handlers to call `dispose()` before exit
- Config: `adapter.local.keepAlive` controls whether model stays loaded between translations

## Implementation Phases

### Phase 1: Foundation
1. Root monorepo setup (`package.json`, `turbo.json`, `tsconfig.base.json`)
2. `packages/shared` — all types, errors, constants, text utils
3. `packages/core/src/config` — Zod schema + config manager

### Phase 2: Adapters
4. `packages/adapters/src/mock.ts` — mock adapter (canned translations)
5. `packages/adapters/src/factory.ts` + `base.ts`
6. `packages/adapters/src/translate-gemma/local.ts` — Ollama

### Phase 3: Core Pipeline
8. `packages/core/src/glossary/store.ts` — SQLite CRUD
9. `packages/core/src/glossary/matcher.ts` — case-insensitive word-boundary matching
10. `packages/core/src/pipeline/preprocess.ts` — tag injection
11. `packages/core/src/pipeline/postprocess.ts` — tag stripping
12. `packages/core/src/pipeline/validate.ts` — glossary coverage + retry
13. `packages/core/src/pipeline/pipeline.ts` — orchestrator

### Phase 4: CLI
14. `apps/cli/src/commands/config.ts` — connect, status
15. `apps/cli/src/commands/translate.ts` — main translate command
16. `apps/cli/src/commands/glossary.ts` — CRUD + import/export
17. `apps/cli/src/commands/context.ts` — add/list/remove/index
18. `apps/cli/src/index.ts` — Commander program

### Phase 5: Context System
19. `packages/core/src/context/indexer.ts` — TF-IDF in SQLite
20. `packages/core/src/context/provider.ts` — add/remove/retrieve

### Phase 6: TUI
21. `apps/tui` — side-by-side translate, glossary manager (launched by `tl` with no args)

## Testing Strategy

| Layer | Scope | Gate |
|-------|-------|------|
| Unit | Glossary matcher, tag injection/stripping, config validation | Always runs |
| Integration | Full pipeline with mock adapter + SQLite | `TEST_INTEGRATION=1` |
| Adapter | Real Ollama/HF calls | `TEST_ADAPTER=1` |
| CLI | Spawn binary, assert stdout/exit codes | Always runs |

Key test cases:
- Strict mode retries on missing term → succeeds on retry
- Prefer mode warns but returns result
- Empty glossary → no tags injected, passthrough
- Tag stripping handles malformed tags
- Config rejects bad schemas with helpful hints
- Adapter auth errors return actionable messages

## Error Handling

```typescript
class TranslateError extends Error {
  constructor(
    readonly tag: "ADAPTER_UNAVAILABLE" | "GLOSSARY_STRICT_FAIL" | "CONFIG_INVALID" | "CONTEXT_INDEX_FAIL",
    message: string,
    readonly hint?: string
  ) { ... }
}
```

Examples:
- `ADAPTER_UNAVAILABLE` + hint: "Run 'translate config connect' to configure your adapter"
- `GLOSSARY_STRICT_FAIL` + hint: "2 glossary terms missing after retry. Use --glossary=prefer to allow partial matches"

## Verification

1. `bun install && bun run build:all` — builds clean
2. `bun run test:all` — unit + integration pass
3. `tl "Hello world" --to ar` with mock adapter → deterministic result
4. `tl glossary add ...` then `tl "..." --glossary=strict` → enforces terms
5. With Ollama: `tl config connect --adapter translate-gemma --backend local` → real translation
