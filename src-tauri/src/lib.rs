mod files;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewWindow, WindowEvent};

use files::TreeNode;

#[derive(Default)]
struct AppState {
    /// One folder watcher per window, keyed by window label.
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    /// File passed on the command line; handed out once to the first window.
    initial_path: Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
struct FsChange {
    paths: Vec<String>,
}

type CommandResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
fn list_tree(root: String) -> CommandResult<Vec<TreeNode>> {
    files::list_tree(Path::new(&root)).map_err(err)
}

#[tauri::command]
fn read_file(path: String) -> CommandResult<String> {
    std::fs::read_to_string(path).map_err(err)
}

#[tauri::command]
fn write_file(path: String, contents: String) -> CommandResult<()> {
    files::atomic_write(Path::new(&path), contents.as_bytes()).map_err(err)
}

#[tauri::command]
fn initial_path(state: State<AppState>) -> Option<String> {
    state.initial_path.lock().unwrap().take()
}

/// Watch `root` recursively and emit `fs-change` to the calling window.
/// Replaces any folder this window was watching before.
#[tauri::command]
fn watch_folder(window: WebviewWindow, state: State<AppState>, root: String) -> CommandResult<()> {
    let label = window.label().to_string();
    let root_path = PathBuf::from(&root);
    let target = window.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter(|p| !is_hidden(&root_path, p))
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if !paths.is_empty() {
            let _ = target.emit_to(target.label(), "fs-change", FsChange { paths });
        }
    })
    .map_err(err)?;
    watcher.watch(Path::new(&root), RecursiveMode::Recursive).map_err(err)?;
    state.watchers.lock().unwrap().insert(label, watcher);
    Ok(())
}

/// True for paths inside hidden entries (e.g. `.git/`, our own temp files).
fn is_hidden(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .map(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')))
        .unwrap_or(false)
}

fn cli_path() -> Option<String> {
    let arg = std::env::args().nth(1).filter(|a| !a.starts_with('-'))?;
    let path = std::path::absolute(arg).ok()?;
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { initial_path: Mutex::new(cli_path()), ..Default::default() })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                state.watchers.lock().unwrap().remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_tree,
            read_file,
            write_file,
            watch_folder,
            initial_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tyset");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_paths_are_relative_to_root() {
        let root = Path::new("/home/me/.notes");
        assert!(!is_hidden(root, Path::new("/home/me/.notes/a.md")));
        assert!(is_hidden(root, Path::new("/home/me/.notes/.git/HEAD")));
        assert!(is_hidden(root, Path::new("/home/me/.notes/.a.md.tyset-tmp")));
    }
}
