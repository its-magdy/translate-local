import {
  createCliRenderer,
  BoxRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { loadConfig } from "@tl/core/config";
import { GlossaryStore } from "@tl/core/glossary";
import { createAdapter } from "@tl/adapters/factory";
import type { Adapter, AdapterConfig } from "@tl/shared/types";
import type { CoreConfig } from "@tl/core/config";
import { makeTranslateView } from "./views/translate";
import { makeGlossaryView } from "./views/glossary";
import { makeCompareView } from "./views/compare";

export interface AppState {
  config: CoreConfig;
  adapter: Adapter;
  glossaryStore: GlossaryStore;
  renderer: CliRenderer;
}

const config = loadConfig();
const adapterCfg: AdapterConfig = {
  backend: config.adapter.backend === "local" ? "ollama" : "huggingface",
  model: config.adapter.backend === "local"
    ? config.adapter.local.model
    : config.adapter.huggingface.model,
  ollamaUrl: config.adapter.local.endpoint,
  hfToken: config.adapter.huggingface.token,
};
const adapter = createAdapter(adapterCfg);
const glossaryStore = new GlossaryStore(config.glossary.dbPath);
const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });

const state: AppState = { config, adapter, glossaryStore, renderer };

async function teardown() {
  glossaryStore.close();
  await adapter.dispose();
  renderer.destroy();
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

// Tab bar
const tabs = new TabSelectRenderable(renderer, {
  id: "tabs",
  width: renderer.width,
  tabWidth: Math.floor(renderer.width / 3),
  options: [
    { name: "Translate", description: "Translate text" },
    { name: "Glossary", description: "Manage glossary" },
    { name: "Compare", description: "Compare adapters" },
  ],
});
root.add(tabs);
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
const compareView = makeCompareView(state, content);

glossaryView.container.visible = false;
compareView.container.visible = false;

let activeIdx = 0;
const views = [translateView, glossaryView, compareView];

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (idx: number) => {
  views[activeIdx].container.visible = false;
  activeIdx = idx;
  views[activeIdx].container.visible = true;
  views[activeIdx].focus();
});

// Global keyboard
renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "c") process.emit("SIGINT" as any);
  if (key.name === "tab" && !key.shift) tabs.focus();
});
