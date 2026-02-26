import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { createAdapter } from "@tl/adapters/factory";
import type { Adapter, AdapterConfig } from "@tl/shared/types";
import type { CoreConfig } from "@tl/core/config";
import { TlError } from "@tl/shared/errors";
import { makeTranslateView } from "./views/translate";
import { makeGlossaryView } from "./views/glossary";
import { C } from "./theme";

export interface AppState {
  config: CoreConfig;
  adapter: Adapter;
  glossaryStore: GlossaryStore;
  renderer: CliRenderer;
}

let config: CoreConfig, adapter: Adapter, glossaryStore: GlossaryStore, renderer: CliRenderer;
try {
  config = loadConfig();
  const adapterCfg: AdapterConfig = {
    backend: config.adapter.backend === "local" ? "ollama" : "huggingface",
    model: config.adapter.backend === "local"
      ? config.adapter.local.model
      : config.adapter.huggingface.model,
    ollamaUrl: config.adapter.local.endpoint,
    hfToken: config.adapter.huggingface.token,
  };
  adapter = createAdapter(adapterCfg);
  glossaryStore = new GlossaryStore(config.glossary.dbPath);
  renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
} catch (err) {
  const msg = err instanceof TlError ? err.hint : String(err);
  console.error(`tl: failed to start — ${msg}`);
  process.exit(1);
}

const state: AppState = { config, adapter, glossaryStore, renderer };

async function teardown() {
  try { glossaryStore.close(); } catch {}
  try { await Promise.race([adapter.dispose(), new Promise(r => setTimeout(r, 3000))]); } catch {}
  try { renderer.destroy(); } catch {}
  process.exit(0);
}

process.on("SIGINT", teardown);
process.on("SIGTERM", teardown);

// Root column
const root = new BoxRenderable(renderer, {
  id: "root",
  flexDirection: "column",
  width: "100%",
  height: "100%",
});
renderer.root.add(root);

// Header bar: wordmark + tabs
const headerBar = new BoxRenderable(renderer, {
  id: "header-bar",
  flexDirection: "row",
  width: "100%",
  height: 3,
});
root.add(headerBar);

// Wordmark
headerBar.add(new TextRenderable(renderer, {
  id: "wordmark",
  content: " tl ",
  fg: C.accent,
}));
headerBar.add(new TextRenderable(renderer, {
  id: "wordmark-sep",
  content: "│ ",
  fg: C.textMuted,
}));

// Tab bar
const tabs = new TabSelectRenderable(renderer, {
  id: "tabs",
  width: renderer.width - 6,
  tabWidth: Math.floor((renderer.width - 6) / 2),
  options: [
    { name: "⇄  Translate", description: "" },
    { name: "⌥  Glossary",  description: "" },
  ],
  wrapSelection: true,
});
headerBar.add(tabs);
tabs.focus();

// Content area
const content = new BoxRenderable(renderer, {
  id: "content",
  flexGrow: 1,
  width: "100%",
});
root.add(content);

// Mount views
const translateView = makeTranslateView(state, content);
const glossaryView = makeGlossaryView(state, content);

glossaryView.container.visible = false;

let activeIdx = 0;
const views = [translateView, glossaryView];

function switchToTab(idx: number) {
  views[activeIdx].container.visible = false;
  activeIdx = idx;
  views[activeIdx].container.visible = true;
  views[activeIdx].focus();
}

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, switchToTab);
tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, switchToTab);

// Global keyboard
renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && (key.name === "c" || key.name === "q")) teardown();
  if (key.name === "tab" && !key.shift) {
    tabs.moveRight();
    tabs.selectCurrent();
  }
});
