# Tyset

Minimal WYSIWYG markdown editor (Tauri 2 + CodeMirror 6 + minium CSS). Scope, architecture
and milestones are in `docs/PLAN.md`; build commands are in `README.md`.

## Testing the GUI headlessly

The dev machine has no display (it is used over SSH), so verify UI changes on a virtual X
display with Xvfb, drive them with xdotool, and screenshot with ImageMagick. Required
packages: `xvfb xdotool imagemagick`.

### Launch

Run each command as its own background process. Don't use `npm run tauri dev` here:
when the app dies it leaves Vite orphaned on port 1420, which breaks the next launch.

```bash
Xvfb :99 -screen 0 1280x800x24 &                 # once per session
npx vite                                         # dev server on :1420 (the debug binary loads from it)
cargo build --manifest-path src-tauri/Cargo.toml # only after Rust changes
DISPLAY=:99 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  LIBGL_ALWAYS_SOFTWARE=1 src-tauri/target/debug/tyset path/to/file.md
```

- The `WEBKIT_*`/`LIBGL_*` variables force software rendering, which WebKitGTK needs on Xvfb.
- Frontend changes hot-reload through Vite; there is no need to restart the app.
- Use throwaway test notes in the scratchpad directory, never real files.

### Find and show windows

Xvfb has no window manager, so **every window starts unmapped and the screenshot is black**.
This includes native dialogs such as the "File changed" prompt.

```bash
export DISPLAY=:99
for w in $(xdotool search --all --name ""); do
  n=$(xdotool getwindowname $w 2>/dev/null); [ -n "$n" ] && echo "$w '$n' $(xdotool getwindowgeometry $w | sed -n 3p)"
done
xdotool windowmap <id>      # main window is titled "… — Tyset" (1100x760); ignore the 10x10 "tyset" one
xdotool windowmove <id> 300 300   # dialogs spawn at 0,0
```

### Drive and inspect

```bash
import -window root shot.png                   # then view the PNG
xdotool mousemove 500 180 click 1              # click (screen coordinates)
xdotool key ctrl+End                           # shortcuts
xdotool type --delay 30 -- "- text"            # `--` needed when the text starts with "-"
xdotool getwindowname <id>                     # window title shows "• " while edits are unsaved
printf 'text' | xsel --clipboard --input       # put text on the clipboard, then: xdotool key ctrl+v
od -c file.md                                  # check line endings (\r\n) on disk
```

- **Keyboard layout:** the user types on a Norwegian keyboard. Test shortcuts with
  `setxkbmap -display :99 no` so xdotool presses the real physical keys (Ctrl+' is the key left of
  Enter, Ctrl+Shift+7 is Ctrl+/).
- **Clipboard image:** hold one with a small GTK script (`Gtk.Clipboard.set_image(Pixbuf)`, then
  `Gtk.main()` for about 60 s). The clipboard empties as soon as the owning process exits.
- **Opening links:** put a fake `xdg-open` that logs its arguments first on the app's `PATH`. It must
  live in the git-ignored `src-tauri/target/`, because the scratchpad is mounted `noexec`.
- **Viewing an exported HTML file:** open it in a GTK WebKit window from Python
  (`gi.require_version("WebKit2", "4.1")`), then map it and screenshot as usual.
- **Printing:** in the print dialog choose "Print to File", which writes `output.pdf` to the
  app's working directory (the repo root). Move it out immediately. Render pages with
  `gs -sDEVICE=png16m -r60 -o page-%d.png file.pdf`.
- **Rust or capability changes** need `cargo build` and an app restart; Vite only hot-reloads the frontend.

The main window can take several seconds to appear. Poll for it with
`xdotool search --name Tyset` (case-insensitive) rather than sleeping a fixed time.

To check auto-save, type, wait about 2 s, then `cat` the file. To check outside changes, edit the
file from the shell while the app is open.

### Clean up

Kill the app and Vite when done: `pkill -x tyset; pkill -f "^node .*vite"`. Don't use
`pkill -f debug/tyset` or similar: it also matches (and kills) the shell running the command,
because the pattern is in that shell's own command line. Check with `pgrep -af "^node .*vite"`
that nothing is left holding port 1420.

## Tests

`npm test` runs the Vitest unit tests (`src/**/*.test.ts`) for pure logic such as the table
model and detection. `cargo test --manifest-path src-tauri/Cargo.toml` runs the Rust tests.
Check UI behaviour headlessly as described above.

## Gotchas

- CodeMirror injects unlayered CSS, which beats anything in minium's cascade layers. Style the
  editor through `EditorView.theme()` in `src/editor/theme.ts`, not `src/styles.css`. Within
  themes, `.cm-line { padding: 0 }` wins ties, so line-class rules need `.cm-line.cm-x` specificity.
- Read editor text with `state.sliceDoc()`, never `state.doc.toString()`. The latter always
  joins with `\n`, which would convert CRLF files to LF on save.
- minium styles `aria-invalid="false"` as a success state, so set the attribute only when
  the value is actually invalid. It also styles anything with `role="button"` as a button, so
  editor widgets with that role need `all: unset` in the editor theme.
- WebKitGTK doesn't expose clipboard images to the page: `clipboardData` has no types, files or items.
  Image paste therefore reads the clipboard in Rust (`paste_clipboard_image`, using arboard).
- `@tauri-apps/plugin-opener`'s `allow-open-url` has no URL scope on its own; `allow-default-urls`
  supplies the http/https/mailto/tel scope.
- minium's `aside.full-height` gives every direct `nav` child `flex: 1`, so the sidebar's tab
  strip has `flex: none` in `src/styles.css`.
- Settings are saved as merged key changes (`update_settings`), so windows don't overwrite
  each other; the frontend owns the shape (`src/settings.ts`).
- Vite reloads every window when `index.html` changes, and each one then restores the last
  file from settings. That's expected when testing, not a bug.
- Block widgets (the table grid) must not have vertical margins: CodeMirror measures them
  without margins, so its height map drifts and up/down cursor motion jumps too far. Use padding.
- CodeMirror's vertical cursor motion skips over block widgets. `src/editor/table.ts`
  catches Up/Down to step into a table's cells.
- A widget's DOM isn't in the page during `toDOM`, so focusing something inside it must wait
  for `requestAnimationFrame`.
- minium sets `th, td { text-align: start }`, which overrides GitHub-style `align="…"`
  attributes; `src/export.css` restores them.
- Live preview only changes decorations (`src/editor/preview.ts`, `accordion.ts`). It must never
  modify the document. Accordion collapse uses CodeMirror folding, which is view state only.
- The formatted view hides blank lines between blocks, as Typora does (`src/editor/blanklines.ts`).
  The space between blocks comes from padding set in `preview.ts`. The cursor skips hidden lines,
  Enter in a paragraph inserts two line breaks, and Shift+Enter inserts one. When driving the app
  with xdotool, check `od -c` rather than assuming where a keystroke landed.
