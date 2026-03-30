# Raycast Extension for `tl`

A Raycast extension that brings `tl` translation capabilities to macOS via Raycast's command palette. Translate text, manage glossaries, and access translation history — all without leaving your current app.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Commands](#commands)
4. [Implementation Plan](#implementation-plan)
5. [Project Setup](#project-setup)
6. [Testing](#testing)
7. [Publishing](#publishing)
8. [Reference](#reference)

---

## Overview

### Value Proposition

- **No competitor**: 20+ translation extensions exist in the Raycast Store, but all use cloud APIs (Google, DeepL, OpenAI). `tl` is the only local-first, glossary-enforced option.
- **Natural UX**: Select text anywhere → hotkey → translate → paste back. Zero context switching.
- **Privacy**: All inference runs locally via Ollama. No data leaves the machine.

### Prerequisites

- macOS with [Raycast](https://raycast.com) installed
- `tl` CLI installed and on `$PATH` (via `bun install -g` or local link)
- Ollama running with `translate-gemma-12b` pulled

---

## Architecture

### Approach: CLI Wrapper (Option A)

The extension calls the `tl` CLI binary via Node.js `child_process` / Raycast's `useExec` hook. This reuses all existing pipeline, glossary, and adapter logic with zero duplication.

**Why not direct import?** Our packages use `bun:sqlite` which doesn't work in Node.js (Raycast's runtime). The CLI wrapper avoids this entirely.

**Why not direct Ollama HTTP?** Would require re-implementing the pipeline, glossary injection, context retrieval, and validation — significant duplication.

```
┌─────────────────────────────────────────┐
│              Raycast Extension          │
│  (React + @raycast/api, Node.js runtime)│
│                                         │
│  useExec("tl", [...args, "--json"])     │
│         │                               │
│         ▼                               │
│  Parse JSON output → Render in UI       │
└─────────┬───────────────────────────────┘
          │ spawns process
          ▼
┌─────────────────────────────────────────┐
│              tl CLI (Bun)               │
│  Pipeline → Glossary → Ollama → Result  │
└─────────────────────────────────────────┘
```

### Extension Location

```
apps/raycast/
├── package.json           # Raycast manifest (NOT part of Bun workspaces)
├── tsconfig.json
├── src/
│   ├── translate.tsx           # Translate Text command
│   ├── translate-selection.tsx # Translate Selection command
│   ├── translate-clipboard.tsx # Translate Clipboard command
│   ├── glossary-list.tsx       # Manage Glossary command
│   ├── glossary-add.tsx        # Add Glossary Entry command
│   └── lib/
│       ├── tl.ts               # CLI wrapper: exec tl with args, parse JSON
│       ├── languages.ts        # Language list for dropdowns
│       └── types.ts            # Response types matching tl --json output
├── assets/
│   ├── icon.png                # 512x512 extension icon
│   └── command-icons/          # Per-command icons (optional)
└── __tests__/
    ├── tl.test.ts              # Unit tests for CLI wrapper
    ├── languages.test.ts       # Language list tests
    └── commands/
        ├── translate.test.tsx  # Component tests
        └── glossary.test.tsx
```

**Important**: `apps/raycast/` must NOT be in the Bun workspaces array. It uses Bun but is completely separate from the monorepo build.

---

## Commands

### 1. Translate Text

**Type**: Form → Detail view
**Trigger**: Search "Translate Text" in Raycast or assign hotkey

```
┌─────────────────────────────────┐
│  Translate Text                 │
│                                 │
│  Text:     [hello world       ] │
│  From:     [Auto-detect    ▾ ] │
│  To:       [Arabic         ▾ ] │
│  Glossary: [Prefer         ▾ ] │
│                                 │
│  [ Translate ]                  │
└─────────────────────────────────┘
         ↓ submits
┌─────────────────────────────────┐
│  Translation Result             │
│                                 │
│  مرحبا بالعالم                  │
│                                 │
│  ─────────────────────────────  │
│  Source: en │ Target: ar        │
│  Glossary: 100% │ 312ms        │
│                                 │
│  ⌘C Copy  ⌘⇧C Copy Source+Target │
└─────────────────────────────────┘
```

**CLI call**: `tl translate "hello world" --from auto --to ar --glossary prefer --json`

### 2. Translate Selection

**Type**: No-view command (background action)
**Trigger**: Hotkey (e.g., `⌘⇧T`) or search "Translate Selection"

**Flow**:
1. `getSelectedText()` → grab highlighted text from any app
2. Show animated toast: "Translating..."
3. `tl translate "{text}" --to {targetLang} --json`
4. `Clipboard.paste(result)` → paste translation in place
5. Show success HUD: "Translated to Arabic"

### 3. Translate Clipboard

**Type**: No-view command
**Trigger**: Search or hotkey

**Flow**: Same as selection but reads from `Clipboard.readText()` and copies result back (doesn't paste).

### 4. Manage Glossary

**Type**: List view
**Trigger**: Search "Manage Glossary"

```
┌──────────────────────────────────────────┐
│  Glossary                    🔍 Filter   │
│                                          │
│  TECH                                    │
│  ├─ API → واجهة برمجية        en → ar    │
│  ├─ database → قاعدة بيانات   en → ar    │
│  └─ neural network → شبكة عصبية en → ar  │
│                                          │
│  LEGAL                                   │
│  └─ plaintiff → المدعي        en → ar    │
│                                          │
│  ⌘N Add Entry  ⌘⌫ Delete  ⌘E Export     │
└──────────────────────────────────────────┘
```

**CLI calls**:
- List: `tl glossary list --json`
- Remove: `tl glossary remove {id}`
- Export: `tl glossary export --json`

### 5. Add Glossary Entry

**Type**: Form
**Trigger**: From Glossary list (⌘N) or search "Add Glossary Entry"

**CLI call**: `tl glossary add --source "{s}" --target "{t}" --from {f} --to {t} --domain {d}`

---

## Implementation Plan

### Phase 1: Project Scaffold

1. Create `apps/raycast/` directory (outside Bun workspaces)
2. Initialize with `npx @anthropic-ai/create-raycast-extension` or manually:
   - `bun init`
   - `bun install @raycast/api @raycast/utils`
   - `bun install -D typescript @types/node`
3. Configure `package.json` with Raycast manifest fields
4. Create `tsconfig.json` extending Raycast's recommended config
5. Add `.gitignore` for `node_modules/`, `build/`
6. Verify dev mode: `bun run dev` loads in Raycast

### Phase 2: Core Library (`src/lib/`)

1. **`tl.ts`** — CLI wrapper module:
   ```typescript
   import { execFile } from "child_process";
   import { promisify } from "util";

   const exec = promisify(execFile);

   interface TlTranslateOptions {
     text: string;
     from?: string;
     to: string;
     glossaryMode?: "prefer" | "strict";
     imagePath?: string;
   }

   interface TlTranslateResult {
     translated: string;
     sourceLang: string;
     targetLang: string;
     glossaryCoverage: number;
     missingTerms: string[];
     metadata: {
       adapter: string;
       durationMs: number;
       retries: number;
     };
   }

   export async function translate(opts: TlTranslateOptions): Promise<TlTranslateResult> {
     const args = ["translate", opts.text, "--to", opts.to, "--json"];
     if (opts.from) args.push("--from", opts.from);
     if (opts.glossaryMode) args.push("--glossary", opts.glossaryMode);
     if (opts.imagePath) args.push("--image", opts.imagePath);

     const { stdout } = await exec(getTlPath(), args, { timeout: 30_000 });
     return JSON.parse(stdout);
   }
   ```
2. **`languages.ts`** — export the 75+ language list for dropdown menus (source from `@tl/shared` constants, hardcoded since we can't import Bun packages)
3. **`types.ts`** — TypeScript types mirroring `tl --json` output shapes
4. **Error handling** — parse stderr for `TlError` JSON, surface tag + hint in Toast

### Phase 3: Translate Commands

1. **`translate.tsx`** — Form-based input with language dropdowns
   - On submit: call `translate()`, navigate to Detail view with markdown result
   - Actions: Copy, Copy Both, Open in TUI, Retry with Strict
2. **`translate-selection.tsx`** — No-view, uses `getSelectedText()` + `Clipboard.paste()`
3. **`translate-clipboard.tsx`** — No-view, uses `Clipboard.readText()` + `Clipboard.copy()`

### Phase 4: Glossary Commands

1. **`glossary-list.tsx`** — List view grouped by domain
   - Search/filter, delete action, export action
   - Navigation to add form
2. **`glossary-add.tsx`** — Form with source/target/from/to/domain/note fields

### Phase 5: Polish & Preferences

1. **Preferences** (in `package.json` manifest):
   - `tlPath` (string, default: `"tl"`) — path to tl binary
   - `defaultTargetLang` (dropdown) — default target language
   - `glossaryMode` (dropdown: prefer/strict) — default glossary mode
   - `ollamaEndpoint` (string) — for status checks
2. **Error states**:
   - `tl` not found → helpful message with install instructions
   - Ollama not running → toast with "Start Ollama" action
   - Translation timeout → retry action
3. **Loading states**: Animated toast during translation, skeleton in list views

### Phase 6: Testing (see [Testing](#testing) section)

### Phase 7: Publishing (see [Publishing](#publishing) section)

---

## Project Setup

### package.json (Raycast Manifest)

```json
{
  "name": "tl-translate",
  "title": "tl Translate",
  "description": "Local-first translation with glossary enforcement via tl + Ollama",
  "icon": "icon.png",
  "author": "its-magdy",
  "license": "MIT",
  "commands": [
    {
      "name": "translate",
      "title": "Translate Text",
      "subtitle": "tl",
      "description": "Translate text with glossary support",
      "mode": "view"
    },
    {
      "name": "translate-selection",
      "title": "Translate Selection",
      "subtitle": "tl",
      "description": "Translate selected text and paste result",
      "mode": "no-view"
    },
    {
      "name": "translate-clipboard",
      "title": "Translate Clipboard",
      "subtitle": "tl",
      "description": "Translate clipboard contents",
      "mode": "no-view"
    },
    {
      "name": "glossary-list",
      "title": "Manage Glossary",
      "subtitle": "tl",
      "description": "View and manage glossary entries",
      "mode": "view"
    },
    {
      "name": "glossary-add",
      "title": "Add Glossary Entry",
      "subtitle": "tl",
      "description": "Add a new glossary term pair",
      "mode": "view"
    }
  ],
  "preferences": [
    {
      "name": "tlPath",
      "title": "tl Binary Path",
      "description": "Path to the tl CLI binary",
      "type": "textfield",
      "default": "tl",
      "required": false
    },
    {
      "name": "defaultTargetLang",
      "title": "Default Target Language",
      "description": "Default language to translate into",
      "type": "dropdown",
      "default": "ar",
      "required": false,
      "data": [
        { "title": "Arabic", "value": "ar" },
        { "title": "French", "value": "fr" },
        { "title": "Spanish", "value": "es" },
        { "title": "German", "value": "de" },
        { "title": "Chinese", "value": "zh" },
        { "title": "Japanese", "value": "ja" },
        { "title": "Korean", "value": "ko" }
      ]
    },
    {
      "name": "glossaryMode",
      "title": "Glossary Mode",
      "description": "How strictly to enforce glossary terms",
      "type": "dropdown",
      "default": "prefer",
      "required": false,
      "data": [
        { "title": "Prefer (suggest terms)", "value": "prefer" },
        { "title": "Strict (require terms)", "value": "strict" }
      ]
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.93",
    "@raycast/utils": "^1.19"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^1.0",
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^3.0",
    "@testing-library/react": "^16.0",
    "eslint": "^9"
  },
  "scripts": {
    "build": "ray build",
    "dev": "ray develop",
    "lint": "ray lint",
    "fix-lint": "ray lint --fix",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Excluding from Bun Workspaces

The root `package.json` workspaces field is `["packages/*", "apps/*"]`. Since `apps/raycast/` would be picked up, either:

- **Option A**: Move to `extensions/raycast/` (outside `apps/`)
- **Option B**: Update root workspaces to explicitly list apps: `["packages/*", "apps/cli", "apps/tui"]`
- **Option C**: Add a `.workspaces-ignore` or use negative globs if supported

**Recommended**: Option B — explicit app listing is clearer.

---

## Testing

### Test Framework

Use **Vitest** (not `bun:test`). The Raycast extension runs in Node.js, so tests should too. Vitest provides Jest-compatible API with TypeScript support.

### Test Strategy

#### 1. Unit Tests — `src/lib/`

**`__tests__/tl.test.ts`** — CLI wrapper logic:
```typescript
import { describe, it, expect, vi } from "vitest";
import { translate, listGlossary } from "../src/lib/tl";

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    // Return mock JSON output matching tl --json format
    const result = {
      translated: "مرحبا",
      sourceLang: "en",
      targetLang: "ar",
      glossaryCoverage: 1.0,
      missingTerms: [],
      metadata: { adapter: "mock", durationMs: 100, retries: 0 }
    };
    cb(null, { stdout: JSON.stringify(result), stderr: "" });
  })
}));

describe("translate", () => {
  it("calls tl with correct args", async () => {
    const result = await translate({ text: "hello", to: "ar" });
    expect(result.translated).toBe("مرحبا");
    expect(result.targetLang).toBe("ar");
  });

  it("passes glossary mode flag", async () => {
    await translate({ text: "hello", to: "ar", glossaryMode: "strict" });
    // Assert execFile was called with --glossary strict
  });

  it("handles tl errors gracefully", async () => {
    // Mock stderr with TlError JSON
    // Assert proper error type is thrown
  });
});
```

**`__tests__/languages.test.ts`**:
```typescript
describe("languages", () => {
  it("exports valid BCP-47 codes", () => { /* ... */ });
  it("includes all 75+ supported languages", () => { /* ... */ });
  it("has no duplicate codes", () => { /* ... */ });
});
```

#### 2. Component Tests — `__tests__/commands/`

Raycast doesn't provide an official test renderer, but components can be tested with:
- **Logic extraction**: Extract hooks/logic into testable functions, test those
- **Snapshot testing**: Verify component output structure

```typescript
// Test the data transformation, not the React rendering
describe("translate command", () => {
  it("builds correct args from form values", () => {
    const args = buildTranslateArgs({
      text: "hello",
      from: "en",
      to: "ar",
      glossaryMode: "strict"
    });
    expect(args).toEqual(["translate", "hello", "--from", "en", "--to", "ar", "--glossary", "strict", "--json"]);
  });

  it("formats result markdown correctly", () => {
    const md = formatResultMarkdown({
      translated: "مرحبا",
      sourceLang: "en",
      targetLang: "ar",
      glossaryCoverage: 1.0,
      missingTerms: [],
      metadata: { adapter: "translate-gemma-local", durationMs: 312, retries: 0 }
    });
    expect(md).toContain("مرحبا");
    expect(md).toContain("312ms");
  });
});
```

#### 3. Integration Tests

Require `tl` and Ollama to be available. Guard with env variable:

```typescript
import { describe, it, expect } from "vitest";

const INTEGRATION = process.env.TEST_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("tl integration", () => {
  it("translates text end-to-end", async () => {
    const result = await translate({ text: "hello", to: "ar" });
    expect(result.translated).toBeTruthy();
    expect(result.targetLang).toBe("ar");
  });

  it("lists glossary entries", async () => {
    const entries = await listGlossary();
    expect(Array.isArray(entries)).toBe(true);
  });
});
```

### Running Tests

```bash
cd apps/raycast   # or extensions/raycast
bun test                          # Unit tests only
TEST_INTEGRATION=1 bun test       # Unit + integration
bun test --watch                  # Watch mode during dev
```

### CI

Add to Turborepo pipeline or run independently:
```bash
cd apps/raycast && bun install --frozen-lockfile && bun test && bun run lint
```

---

## Publishing

### Option 1: Raycast Store (Recommended)

All Raycast Store extensions live in the [`raycast/extensions`](https://github.com/raycast/extensions) monorepo. Publishing process:

1. **Fork** `raycast/extensions` on GitHub
2. **Create extension** in the fork:
   ```bash
   cd extensions
   npx @anthropic-ai/create-raycast-extension   # or copy our apps/raycast/
   ```
3. **Follow store guidelines**:
   - Extension must be self-contained (no workspace dependencies)
   - Include screenshots (1270x760px) in `metadata/` directory
   - Write clear description and categories
   - Ensure `ray lint` passes
4. **Submit PR** to `raycast/extensions`
5. **Review**: Raycast team + community review (usually 1-2 weeks)
6. **Published**: Users install via Raycast Store search

**Requirements for store listing**:
- `metadata/tl-translate-1.png` — screenshot of Translate Text command
- `metadata/tl-translate-2.png` — screenshot of translation result
- `metadata/tl-translate-3.png` — screenshot of glossary management
- `CHANGELOG.md` — version history
- `README.md` — setup instructions (Ollama + tl installation)
- All code is open source (MIT or similar)

### Option 2: Local / Manual Distribution

For users who want to use it without the store:

```bash
git clone https://github.com/its-magdy/tl
cd tl/apps/raycast
bun install
bun run dev     # Loads into Raycast in dev mode
```

Or build and import:
```bash
bun run build
# In Raycast: Import Extension → select apps/raycast/
```

### Option 3: Private Distribution (Raycast for Teams)

If distributing within an organization, use Raycast's private extension hosting. Requires Raycast for Teams subscription.

### Versioning

- Follow the same semver approach as other `tl` packages
- Start at `0.1.0`
- Maintain `CHANGELOG.md` in the extension directory
- Raycast Store shows version from `package.json`

---

## Reference

### Raycast Developer Docs

- [Getting Started](https://developers.raycast.com/basics/getting-started)
- [API Reference](https://developers.raycast.com/api-reference)
- [useExec Hook](https://developers.raycast.com/utilities/react-hooks/useexec)
- [Preferences](https://developers.raycast.com/information/manifest#preferences)
- [Publishing](https://developers.raycast.com/basics/publish-an-extension)
- [Store Guidelines](https://developers.raycast.com/information/review)
- [Security Model](https://developers.raycast.com/information/security)

### Existing Extensions for Reference

| Extension | Relevance | Link |
|-----------|-----------|------|
| Ollama AI | Local LLM via Ollama | [GitHub](https://github.com/MassimilianoPasquini97/raycast_ollama) |
| OpenAI Translator | Translation UX patterns | [Store](https://www.raycast.com/douo/openai-translator) |
| antfu/multi-translate | Multi-language UI | [GitHub](https://github.com/antfu/raycast-multi-translate) |
| DeepCast (DeepL) | Simple translation UX | [Store](https://www.raycast.com/mooxl/deepcast) |

### Key Raycast APIs Used

| API | Used For |
|-----|----------|
| `Form` | Text input, language selection, glossary mode |
| `Detail` | Translation result display (markdown) |
| `List` | Glossary entry browsing |
| `ActionPanel` / `Action` | Copy, paste, delete, navigate |
| `getSelectedText()` | Translate Selection command |
| `Clipboard.readText()` / `.copy()` / `.paste()` | Clipboard translation |
| `showToast()` / `showHUD()` | Progress and success feedback |
| `getPreferenceValues()` | User settings (target lang, tl path) |
| `useExec()` | Execute tl CLI binary |
| `LocalStorage` | Cache recent translations (optional) |

### tl CLI Flags Used by Extension

```bash
# Translation
tl translate "{text}" --from {lang} --to {lang} --glossary {mode} --json
tl translate --image {path} --to {lang} --json

# Glossary
tl glossary list --json
tl glossary list --from {lang} --to {lang} --domain {domain} --json
tl glossary add --source "{s}" --target "{t}" --from {f} --to {t} [--domain {d}] [--note "{n}"]
tl glossary remove {id}
tl glossary export --json

# Config
tl config status    # Health check: is Ollama running?
```

All commands use `--json` flag for machine-readable output that the extension parses.

### Future Considerations

- **MCP Server**: Like better-context (btca), adding an MCP server to `tl` would let Claude Code, Cursor, and other AI tools call translations inline. This is a separate distribution channel worth pursuing alongside Raycast.
- **Translation History**: Store recent translations in `LocalStorage` for quick re-access.
- **Quicklink Support**: Deep links like `raycast://extensions/tl/translate?text=hello&to=ar` for automation.
- **Menu Bar Command**: Persistent menu bar icon showing last translation, quick access to translate clipboard.
- **Fallback Search**: Register as a fallback for Raycast's root search — type text, see "Translate with tl" as a suggestion.
