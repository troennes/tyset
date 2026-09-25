# Tyset

A minimal WYSIWYG markdown editor for Linux and Windows, in the spirit of Typora.
See [docs/PLAN.md](docs/PLAN.md) for scope, architecture and milestones.

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
cargo test --manifest-path src-tauri/Cargo.toml
```

## Layout

- `src/` — frontend (TypeScript, CodeMirror 6, minium CSS)
- `src-tauri/` — Rust backend (file I/O, atomic saves, folder watching)
- `docs/PLAN.md` — the plan
