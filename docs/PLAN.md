# Tyset — plan

A minimal WYSIWYG markdown editor for Linux and Windows, modelled on Typora but with
only the features we actually use.

## Guiding principles

- **The file on disk is plain GitHub-flavoured markdown.** Tyset never invents syntax.
  Where markdown has no construct (e.g. accordions), we store the HTML that GitHub
  itself renders (`<details>`), and give it a first-class editing experience.
- **Lossless.** The editor edits the markdown source directly; saving never reformats
  text you did not touch. This matters because auto-save writes continuously.
- **Small.** Few dependencies, one theme, no plugin system.

## Stack

| Layer    | Choice                                                   |
|----------|----------------------------------------------------------|
| Shell    | Tauri 2 (Rust backend, system web view)                  |
| Editor   | CodeMirror 6 + `@lezer/markdown` (GFM) + custom live-preview layer |
| UI       | Vanilla TypeScript, Vite, [minium](https://minium.style) (`@troennes/minium`) |
| Export   | `comrak` (Rust, GFM + alerts) → HTML; PDF via print dialog |
| Packages | Windows NSIS installer, Linux `.deb`                     |

## Architecture

```
┌──────────────── Frontend (TS, web view) ────────────────┐
│ Sidebar: folder tree │ Outline    Editor (CodeMirror 6)  │
│                      │            - live preview layer   │
│                      │            - source mode toggle   │
│                      │            - find/replace panel   │
│                      │            - table grid widget    │
└──────────────── Tauri commands / events ────────────────┘
┌──────────────── Backend (Rust) ─────────────────────────┐
│ fs: read, atomic write (temp → fsync → rename)          │
│ watcher (notify): tree updates, external changes        │
│ assets: copy dropped/pasted images → ./assets           │
│ export: comrak → HTML (+ inlined CSS) → print for PDF   │
│ settings, last folder, window state; links → browser    │
└─────────────────────────────────────────────────────────┘
```

## Features

### Files
- Open a folder; left sidebar shows a tree of `.md`/`.markdown`/`.txt` files, plus an
  outline tab built from the document's headings.
- One document per window. Ctrl+Shift+N opens a new window.
- New file, rename, delete (to trash) from the tree.

### Saving
- **Always auto-save** to the real file ~1 s after typing stops, and on file switch,
  window blur and close. Ctrl+S saves immediately.
- Atomic writes: temp file in the same directory → fsync → rename.
- **Local history:** the last N versions of each file are kept in the app data dir as a
  safety net against unwanted auto-saves.
- External change: reload silently if there are no pending edits; otherwise ask.

### Editing
- Live preview: markdown syntax is hidden except on the line/element under the cursor.
- Full GFM: headings, emphasis, strikethrough, lists, task lists (clickable boxes),
  quotes, alerts (`> [!NOTE]` etc.), code fences with syntax highlighting, tables,
  autolinks, images, horizontal rules. (No footnotes.)
- Tables: grid editor (Tab/Shift+Tab between cells, add/remove rows and columns, column
  alignment, Ctrl+T to insert); written back as aligned pipe tables. Only an edited table
  is reformatted.
- Images: rendered inline. Dropping/pasting an image file copies it into `./assets/`
  next to the document and inserts a relative link.
- Paste is always plain text (image files are the only exception).
- Links: Ctrl+click opens in the default browser.
- Source mode toggle (Ctrl+/) shows the raw markdown.
- Find (Ctrl+F) and replace (Ctrl+H).

### Accordions (and other HTML fallbacks)
Markdown has no collapsible section, so Tyset stores the HTML GitHub renders:

```markdown
<details>
<summary>Title</summary>

Any **markdown** here, including lists, code and nested accordions.

</details>
```

- The blank lines around the body are required for GitHub to render the inner markdown;
  Tyset always writes them.
- **Inserting:** Ctrl+Shift+D (or a command) inserts an accordion, wrapping the current
  selection as its body if there is one. You never type the tags yourself.
- **Editing:** in live preview the tag lines are hidden and replaced by a header row with
  a disclosure triangle and an editable title. The body is ordinary live-preview
  markdown. With the cursor on the tag lines, or in source mode, the raw HTML shows.
- **Collapse/expand in the editor is view state only** and never modifies the file.
  `<details open>` is honoured as the initial state and can be toggled via a command.
- Other GitHub-safe inline HTML is rendered: `<kbd>`, `<br>`, `<sup>`, `<sub>`, `<mark>`.
  Any other HTML is shown as source text.

### Export
- HTML: standalone file with inlined CSS.
- PDF: same HTML rendered with print CSS → OS print dialog → "Save as PDF".

### Views
- One theme with light and dark modes. Follows the OS until the status-bar button is used,
  which sets minium's `data-theme` on `<html>` (and the native title bar) and is remembered.
- Toggle sidebar. No zoom, focus, typewriter, read-only or fullscreen modes.

## Keyboard shortcuts

| Action              | Shortcut          |
|---------------------|-------------------|
| Bold / italic       | Ctrl+B / Ctrl+I   |
| Inline code         | Ctrl+' (also Ctrl+`) |
| Code block          | Ctrl+Shift+' (Ctrl+* on Norwegian keyboards) |
| Link                | Ctrl+K            |
| Heading 1–6 / para  | Ctrl+1…6 / Ctrl+0 |
| Accordion           | Ctrl+Shift+D      |
| Table               | Ctrl+T            |
| Find / replace      | Ctrl+F / Ctrl+H   |
| Source mode         | Ctrl+/            |
| Save now            | Ctrl+S            |
| Open file / folder  | Ctrl+O / Ctrl+Shift+O |
| New file / window   | Ctrl+N / Ctrl+Shift+N |
| Toggle sidebar      | Ctrl+Shift+L      |
| Print / PDF         | Ctrl+P            |
| Undo / redo         | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) |

## Out of scope
Diagrams, math, zoom, focus/typewriter/read-only modes, themes, spell check, word
count, rich-text paste, tabs, auto-updater.

## Milestones

1. **Skeleton** — Tauri + Vite + minium; open folder, file tree, open file in plain
   CodeMirror, atomic auto-save, file watcher.
2. **Core editing** — GFM parsing, shortcuts, find/replace, plain-text paste, source mode.
3. **Live preview** — hidden syntax, headings, emphasis, links, lists, task boxes,
   quotes/alerts, accordions, code fences, images, image drop/paste into assets.
4. **Polish** — outline, light/dark, settings, conflict handling, local history.
5. **Table grid editor.**
6. **Export** — HTML, PDF via print dialog.
7. **Packaging** — `.deb` + NSIS installer, GitHub Actions CI for both.

## Status

- Milestones 1–5 are done.
- Settings: `settings.json` in the app config dir (Linux: `~/.config/no.troennes.tyset/`).
  Local history: `history/` in the app data dir (Linux: `~/.local/share/no.troennes.tyset/`),
  at most one snapshot per file every 5 minutes, 50 kept per file.
- Still to do from the Files section: rename and delete from the tree.
- Not yet supported: in-page `#heading` links, and toggling `<details open>` from a command.
  Footnotes are out of scope.
- Tables: the grid covers top-level tables. Tables inside quotes or lists stay as pipe text.
- Dropping files on the window is implemented but untested: it can't be simulated headlessly.

## Risks
- Live preview cursor/selection behaviour is the most delicate part; tables next.
- WebKitGTK (Linux) is slower and quirkier than WebView2; test on Ubuntu throughout.
  minium uses `light-dark()`, which needs WebKitGTK ≥ 2.44 (Ubuntu 24.04 is fine).
