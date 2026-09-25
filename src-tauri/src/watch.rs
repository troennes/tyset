//! File system watching: tells a window when files it shows change on disk.

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Emitter, WebviewWindow};

#[derive(Serialize, Clone)]
struct FsChange {
    paths: Vec<String>,
}

/// Watch `root` and emit `fs-change` to `window` for every non-hidden path that changes.
pub fn watch(window: &WebviewWindow, root: &Path, recursive: bool) -> notify::Result<RecommendedWatcher> {
    let root_path: PathBuf = root.to_path_buf();
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
    })?;
    let mode = if recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
    watcher.watch(root, mode)?;
    Ok(watcher)
}

/// True for paths inside hidden entries (e.g. `.git/`, our own temp files).
fn is_hidden(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .map(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')))
        .unwrap_or(false)
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
