//! Reading the folder tree and writing files safely.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Extensions shown in the tree (compared case-insensitively).
const DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];
/// Guards against opening e.g. a home directory with a huge tree.
const MAX_DEPTH: usize = 12;

#[derive(Serialize, Debug, PartialEq)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    /// `Some` for directories, `None` for files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

/// Documents under `root`, directories first, hidden entries and
/// directories without documents left out.
pub fn list_tree(root: &Path) -> io::Result<Vec<TreeNode>> {
    list_dir(root, 0)
}

fn list_dir(dir: &Path, depth: usize) -> io::Result<Vec<TreeNode>> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // file_type() does not follow symlinks, so symlinked dirs (and loops) are skipped.
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_dir() {
            if depth >= MAX_DEPTH {
                continue;
            }
            // Unreadable subdirectories are skipped rather than failing the whole tree.
            let children = list_dir(&path, depth + 1).unwrap_or_default();
            if !children.is_empty() {
                dirs.push(node(name, &path, Some(children)));
            }
        } else if is_document(&path) {
            files.push(node(name, &path, None));
        }
    }
    let by_name = |a: &TreeNode, b: &TreeNode| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    dirs.sort_by(by_name);
    files.sort_by(by_name);
    dirs.extend(files);
    Ok(dirs)
}

fn node(name: String, path: &Path, children: Option<Vec<TreeNode>>) -> TreeNode {
    TreeNode { name, path: path.to_string_lossy().into_owned(), children }
}

pub fn is_document(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| DOCUMENT_EXTENSIONS.iter().any(|d| d.eq_ignore_ascii_case(e)))
}

/// Replace `path` with `contents` so that a crash leaves either the old or the
/// new file, never a partial one: write a temp file beside it, fsync, rename.
pub fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    // Write through symlinks instead of replacing the link itself.
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let tmp = temp_path(&target);

    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        if let Ok(meta) = fs::metadata(&target) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;

    // Persist the rename itself (not supported on Windows, where rename is durable enough).
    #[cfg(unix)]
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

fn temp_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.tyset-tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"one").unwrap();
        atomic_write(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        // No temp file left behind.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_follows_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.md");
        let link = dir.path().join("link.md");
        fs::write(&real, "old").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        atomic_write(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    }

    #[test]
    fn tree_filters_sorts_and_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("b-notes")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("b-notes/x.MD"), "").unwrap();
        fs::write(root.join(".git/HEAD.md"), "").unwrap();
        fs::write(root.join("Zeta.md"), "").unwrap();
        fs::write(root.join("alpha.txt"), "").unwrap();
        fs::write(root.join("image.png"), "").unwrap();

        let names: Vec<_> = list_tree(root).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(names, ["b-notes", "alpha.txt", "Zeta.md"]);
    }
}
