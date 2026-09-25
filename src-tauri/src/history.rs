//! Local history: before a file is overwritten, keep a copy of what was on disk.
//! Snapshots are coarse (at most one per file every few minutes) because auto-save
//! writes constantly; they live in the app data directory, never beside the file.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A new snapshot is taken only if the newest one is older than this.
const MIN_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// Snapshots kept per file.
const MAX_SNAPSHOTS: usize = 50;
const SOURCE_FILE: &str = "source.txt";

#[derive(Serialize, Debug, PartialEq)]
pub struct Snapshot {
    /// File name within the history folder, e.g. `1790330696123.md`.
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub saved: u64,
    pub size: u64,
}

/// Folder holding the snapshots of `path` (named by a stable hash of the path).
fn folder(history_root: &Path, path: &Path) -> PathBuf {
    history_root.join(format!("{:016x}", fnv1a(path.to_string_lossy().as_bytes())))
}

/// FNV-1a: tiny and, unlike `DefaultHasher`, stable across Rust versions.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &b| (hash ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Keep `old` (the previous contents of `path`) unless a recent snapshot exists.
pub fn snapshot(history_root: &Path, path: &Path, old: &[u8]) -> io::Result<()> {
    snapshot_at(history_root, path, old, now_ms())
}

fn snapshot_at(history_root: &Path, path: &Path, old: &[u8], now: u64) -> io::Result<()> {
    let dir = folder(history_root, path);
    let existing = list_in(&dir)?;
    if let Some(newest) = existing.first() {
        if now.saturating_sub(newest.saved) < MIN_INTERVAL.as_millis() as u64 {
            return Ok(());
        }
    }
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(SOURCE_FILE), path.to_string_lossy().as_bytes())?;
    crate::files::atomic_write(&dir.join(format!("{now}.md")), old)?;
    for stale in existing.iter().skip(MAX_SNAPSHOTS - 1) {
        let _ = fs::remove_file(dir.join(&stale.id));
    }
    Ok(())
}

/// Snapshots of `path`, newest first.
pub fn list(history_root: &Path, path: &Path) -> io::Result<Vec<Snapshot>> {
    list_in(&folder(history_root, path))
}

fn list_in(dir: &Path) -> io::Result<Vec<Snapshot>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut snapshots: Vec<Snapshot> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let id = entry.file_name().to_string_lossy().into_owned();
            let saved = id.strip_suffix(".md")?.parse().ok()?;
            Some(Snapshot { saved, size: entry.metadata().ok()?.len(), id })
        })
        .collect();
    snapshots.sort_by(|a, b| b.saved.cmp(&a.saved));
    Ok(snapshots)
}

pub fn read(history_root: &Path, path: &Path, id: &str) -> io::Result<String> {
    // Ids come from the page: accept only our own `<digits>.md` names.
    let valid = id.strip_suffix(".md").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    if !valid {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid snapshot id"));
    }
    fs::read_to_string(folder(history_root, path).join(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_are_throttled_listed_and_read() {
        let root = tempfile::tempdir().unwrap();
        let doc = Path::new("/notes/a.md");
        let minute = 60_000;
        snapshot_at(root.path(), doc, b"v1", 10 * minute).unwrap();
        snapshot_at(root.path(), doc, b"v2", 12 * minute).unwrap(); // too soon: skipped
        snapshot_at(root.path(), doc, b"v3", 16 * minute).unwrap();

        let list = list(root.path(), doc).unwrap();
        assert_eq!(list.iter().map(|s| s.saved).collect::<Vec<_>>(), [16 * minute, 10 * minute]);
        assert_eq!(read(root.path(), doc, &list[0].id).unwrap(), "v3");
        assert_eq!(read(root.path(), doc, &list[1].id).unwrap(), "v1");
        // Another file has its own history.
        assert!(super::list(root.path(), Path::new("/notes/b.md")).unwrap().is_empty());
    }

    #[test]
    fn old_snapshots_are_pruned() {
        let root = tempfile::tempdir().unwrap();
        let doc = Path::new("/notes/a.md");
        for i in 0..(MAX_SNAPSHOTS as u64 + 5) {
            snapshot_at(root.path(), doc, b"x", i * 10 * 60_000).unwrap();
        }
        assert_eq!(list(root.path(), doc).unwrap().len(), MAX_SNAPSHOTS);
    }

    #[test]
    fn rejects_path_traversal() {
        let root = tempfile::tempdir().unwrap();
        assert!(read(root.path(), Path::new("/a.md"), "../../etc/passwd").is_err());
        assert!(read(root.path(), Path::new("/a.md"), ".md").is_err());
    }
}
