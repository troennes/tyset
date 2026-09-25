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

The main window can take several seconds to appear. Poll for it with
`xdotool search --name Tyset` (case-insensitive) rather than sleeping a fixed time.

To check auto-save, type, wait about 2 s, then `cat` the file. To check outside changes, edit the
file from the shell while the app is open.

### Clean up

Kill the app and Vite when done: `pkill -x tyset; pkill -f "^node .*vite"`. Don't use
`pkill -f debug/tyset` or similar: it also matches (and kills) the shell running the command,
because the pattern is in that shell's own command line. Check with `pgrep -af "^node .*vite"`
that nothing is left holding port 1420.

## Gotchas

- CodeMirror injects unlayered CSS, which beats anything in minium's cascade layers. Style the
  editor through `EditorView.theme()` in `src/editor/theme.ts`, not `src/styles.css`. Within
  themes, `.cm-line { padding: 0 }` wins ties, so line-class rules need `.cm-line.cm-x` specificity.
- Read editor text with `state.sliceDoc()`, never `state.doc.toString()`. The latter always
  joins with `\n`, which would convert CRLF files to LF on save.
- minium styles `aria-invalid="false"` as a success state, so set the attribute only when
  the value is actually invalid.
