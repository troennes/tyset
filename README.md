# Tyset

A minimal WYSIWYG markdown editor for Linux and Windows, in the spirit of Typora.
See [docs/PLAN.md](docs/PLAN.md) for scope, architecture and milestones.

## Install

Download an installer from the GitHub release (or a CI build's artifacts):

- **Ubuntu 24.04+ / Debian-based:** `sudo apt install ./Tyset_<version>_amd64.deb`
  (apt pulls in WebKitGTK). Tyset then opens `.md` files from the file manager.
- **Windows 10/11:** run `Tyset_<version>_x64-setup.exe`. It installs for the current
  user (no admin rights) and fetches WebView2 if it is missing.

## Development

Prerequisites: Node.js 22+, Rust (via [rustup](https://rustup.rs)), and on Linux the
Tauri system libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Windows needs the Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 10/11).

```bash
npm install
npm run tauri dev             # run the app with hot reload
npm run tauri build           # .deb on Linux, NSIS installer on Windows
npm test                      # frontend unit tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml
```

Rustup puts `cargo` in `~/.cargo/bin`; open a new shell (or `source ~/.cargo/env`) so it's on
your `PATH`.

### Headless GUI testing

To check the UI over SSH without a display (see `CLAUDE.md`), you also need a virtual X
server and tools to drive it, take screenshots, set the keyboard layout and use the clipboard.
Ghostscript renders printed PDFs, and the WebKit bindings for Python open exported HTML:

```bash
sudo apt install xvfb xdotool imagemagick xsel x11-xkb-utils ghostscript \
  python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

## Releases

CI (`.github/workflows/build.yml`) tests and builds both installers on every push.
To release, bump the version in `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json`, then push a tag such as `v0.2.0`. This creates a draft
GitHub release with the installers attached.

## Layout

- `src/` — frontend (TypeScript, CodeMirror 6, minium CSS)
- `src-tauri/` — Rust backend (file I/O, atomic saves, folder watching)
- `docs/PLAN.md` — the plan

## License

[MIT](LICENSE)
