# TUI Guide

Launch the interactive terminal UI with no arguments:

```bash
tl
```

---

## Layout

The TUI has two tabs, switchable with **Tab** / **Shift+Tab**:

- **Translate** — side-by-side source and target panes
- **Glossary** — manage glossary entries

---

## Translate Tab

### Basic usage

1. Type (or paste) text into the left pane
2. Press **Ctrl+T** to translate
3. The translation appears in the right pane

Language selectors at the top control the source and target languages. Source defaults to auto-detect; target defaults to the language in your config (fallback: French).

The status bar at the bottom shows translation progress, glossary coverage, and duration after each translation.

### Image translation

The TUI can translate text in images in three ways:

**1. Drag and drop** — drag an image from Finder into the source pane. The path is auto-detected and translated.

**2. Paste a path** — paste an image file path directly. It is auto-wrapped and translated.

**3. Embed in text** — include an image path inline using single quotes:

```
Translate this: '/path/to/screenshot.png' — what does it say?
```

The image text is extracted and translated alongside your surrounding text.

Supported formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`

---

## Glossary Tab

View, add, and delete glossary entries.

### Adding an entry

1. Type the source term in the left input
2. Type the target translation in the right input
3. Set source and target languages using the dropdowns
4. Press **Enter** in the target input to save

### Deleting an entry

Navigate the list with **Up/Down** arrows, then press **Ctrl+D** to delete the selected entry.

---

## Keybindings

| Key | Action |
|-----|--------|
| **Ctrl+T** | Translate |
| **Tab** | Switch to next tab |
| **Shift+Tab** | Switch to previous tab |
| **Up / Down** | Navigate glossary list |
| **Ctrl+D** | Delete selected glossary entry |
| **Ctrl+Q** / **Ctrl+C** | Quit |

---

## Exit

Quitting gracefully unloads the model from memory and closes the database. Use **Ctrl+Q** or **Ctrl+C**.
