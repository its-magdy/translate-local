import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  type CliRenderer,
} from "@opentui/core";
import { loadConfig } from "@translate-local/core/config";
import type { GlossaryStore } from "@translate-local/core/glossary";
import { TranslationSession } from "@translate-local/core/session";
import type { CoreConfig } from "@translate-local/core/config";
import { TlError } from "@translate-local/shared/errors";
import { makeTranslateView } from "./views/translate";
import { makeGlossaryView } from "./views/glossary";
import { C } from "./theme";

export interface AppState {
  config: CoreConfig;
  session: TranslationSession;
  glossaryStore: GlossaryStore;
  renderer: CliRenderer;
}

export async function runTui(): Promise<void> {
  let config: CoreConfig, session: TranslationSession, renderer: CliRenderer;
  try {
    config = loadConfig();
    session = new TranslationSession(config);
    renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
  } catch (err) {
    const msg = err instanceof TlError ? err.hint : String(err);
    console.error(`tl: failed to start — ${msg}`);
    process.exit(1);
  }

  const state: AppState = { config, session, glossaryStore: session.glossaryStore, renderer };

  // Restore the terminal first so quitting looks instant, then cancel any
  // in-flight translation and give the model unload up to 3 s.
  let tearingDown = false;
  async function teardown() {
    if (tearingDown) return;
    tearingDown = true;
    session.abort();
    try { renderer.destroy(); } catch {}
    try { await Promise.race([session.dispose(), new Promise(r => setTimeout(r, 3000))]); } catch {}
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
}

if (import.meta.main) {
  await runTui();
}
