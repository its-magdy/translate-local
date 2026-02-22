# better-context (btca) — Architecture Analysis

> Source: https://github.com/davis7dotsh/better-context

## What It Is

An AI-powered code documentation search tool. Users ask natural language questions about codebases, and an AI agent searches through actual source code to answer them. CLI-first with optional web UI.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **Monorepo**: Turborepo
- **CLI**: Commander.js
- **TUI**: OpenTUI (React-based terminal UI)
- **Server**: Hono (lightweight HTTP framework)
- **Web**: SvelteKit + Convex (serverless backend) + Clerk (auth)
- **AI**: Vercel AI SDK (unified model abstraction)
- **Validation**: Zod
- **Testing**: bun:test

## Monorepo Structure

```
better-context/
├── apps/
│   ├── cli/            # Command-line interface (Commander.js)
│   ├── server/         # Core API server (Hono)
│   ├── web/            # Web UI (SvelteKit + Convex)
│   ├── sandbox/        # Sandboxed server instances (Daytona SDK)
│   ├── docs/           # Documentation site
│   └── analytics-proxy/# PostHog analytics proxy
├── packages/
│   └── shared/         # Shared types, utilities, constants
└── skills/
    └── btca-cli/       # CLI skill definitions
```

## CLI Commands

```
btca [options] [command]

Resource Management:
  add <url>              Add git/local/npm resource
  remove <name>          Remove resource
  resources              List resources

Query:
  ask                    Ask single question (supports @mentions for resources)

Configuration:
  connect                Set provider/model
  disconnect             Clear provider
  init                   Initialize project
  status                 Show current config

Interactive:
  tui                    Rich terminal UI
  repl                   Simple REPL (for minimal terminals)

Server:
  serve                  Start API server
  mcp                    MCP integration

Utility:
  clear                  Clear cache
  wipe                   Reset all config
  skill                  Skill management
  telemetry              Toggle analytics
```

## Server Architecture (Hono)

### Endpoints
```
GET  /                    Health check
GET  /config              Current configuration
GET  /resources           Configured resources
PUT  /config/model        Update provider/model
POST /config/resources    Add resource
DELETE /config/resources  Remove resource
POST /clear              Clear cached resources
POST /question           Non-streaming question
POST /question/stream    Streaming SSE response
```

### Service Layer Pattern
Each subsystem is a namespace with a Service object:
```typescript
namespace Agent { Service { ask(), askStream() } }
namespace Resources { Service { load() } }
namespace Collections { Service { create() } }
```

## Agent System

The AI agent is given 4 tools to search code:
- `read(path, lines)` — file contents with line numbers
- `grep(pattern, glob, flags)` — matching lines with context
- `glob(pattern)` — file paths matching pattern
- `list(path)` — directory listing

System prompt instructs: "You are btca, an expert documentation search agent." Agent iterates tool calls until it has enough info to answer.

## Resource Types

```typescript
type ResourceDefinition = GitResource | NpmResource | LocalResource

GitResource:   { name, url, branch, searchPath?, specialNotes? }
NpmResource:   { name, package, version? }
LocalResource: { name, path }
```

Resources are cloned/cached locally and mounted via a Virtual File System (VFS) for sandboxing.

## Provider System

Factory pattern — `PROVIDER_REGISTRY` maps provider IDs to factory functions:

```typescript
type ProviderFactory = (options?) => (modelId: string) => ModelClient
```

Supported providers:
- OpenCode (default), OpenAI, Anthropic, Google Gemini, OpenRouter, GitHub Copilot, OpenAI-compatible, MiniMax

15+ curated models with pricing data from models.dev.

## Streaming (SSE)

```typescript
type BtcaStreamEvent =
  | { type: 'meta'; model, resources, collection }
  | { type: 'text.delta'; delta }
  | { type: 'reasoning.delta'; delta }
  | { type: 'tool.updated'; callID, tool, state }
  | { type: 'done'; text, reasoning, tools[], usage?, metrics? }
  | { type: 'error'; tag, message, hint? }
```

## Config System

Location: `~/.config/btca/btca.config.jsonc`

```jsonc
{
  "$schema": "https://btca.dev/btca.schema.json",
  "provider": "opencode",
  "model": "claude-haiku-4-5",
  "dataDirectory": "~/.local/share/btca",
  "providerTimeoutMs": 300000,
  "maxSteps": 40,
  "providerOptions": { ... },
  "resources": [
    { "type": "git", "name": "svelte", "url": "...", "branch": "main", "searchPath": "..." }
  ]
}
```

Zod-validated at load time. Supports legacy migration from older config formats.

## Error Handling

```typescript
class TaggedError extends Error {
  constructor(tag: string, message: string, hint?: string) { ... }
}
```

The `hint` field provides actionable user guidance.

## Security

- Resource names: validated against injection patterns
- Git URLs: HTTPS only, no embedded credentials, no private IPs
- VFS sandboxing: agents can't access real filesystem
- Input validation: Zod schemas on all API inputs

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Bun-only | Performance, simpler toolchain, native TS |
| Hono for HTTP | Lightweight, TS-first, edge-compatible |
| Zod for validation | Type inference + composable schemas |
| Virtual FS | Sandboxing, no side effects |
| SSE streaming | Real-time feedback, standard protocol |
| AI SDK | Unified provider abstraction |

## Web App (SvelteKit + Convex)

Multi-tenant web UI with:
- Clerk authentication
- Convex serverless backend (schema: instances, projects, resources, messages, threads)
- Conversation persistence and threading
- Subscription management (Pro/Free)
- Resource caching and lifecycle

## What We're Borrowing for Our Translation Tool

1. **Monorepo structure** (Bun + Turborepo + packages/apps split)
2. **Service layer pattern** (namespaced services)
3. **Provider/adapter factory** (pluggable model backends)
4. **Config with Zod validation** (JSONC config file)
5. **TaggedError with hints** (actionable error messages)
6. **Commander.js CLI** (command structure)
7. **TUI with OpenTUI** (interactive terminal UI)
8. **Testing approach** (bun:test, integration test gates)
