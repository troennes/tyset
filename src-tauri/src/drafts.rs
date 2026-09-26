//! Untitled documents: real files in a drafts folder in the app data directory,
//! so auto-save and history work as for any file. Saving one moves it elsewhere.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use crate::files;

/// A new, unused path in `dir` (the file itself is written on the first save).
pub fn new_path(dir: &Path, stamp: &str) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    for n in 0.. {
        let name = if n == 0 { format!("Untitled-{stamp}.md") } else { format!("Untitled-{stamp}-{n}.md") };
        let path = dir.join(name);
        if !path.exists() {
            return Ok(path);
        }
    }
    unreachable!()
}

/// A draft held open by a window. The lock (an OS file lock, so it also covers other
/// Tyset processes and is released if the app crashes) keeps crash recovery off it.
pub struct Claim {
    pub path: PathBuf,
    lock: Option<File>,
}

impl Drop for Claim {
    fn drop(&mut self) {
        if self.lock.take().is_some() {
            let _ = fs::remove_file(lock_path(&self.path));
        }
    }
}

fn lock_path(draft: &Path) -> PathBuf {
    let name = draft.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    draft.with_file_name(format!(".{name}.lock"))
}

/// Claim `path` for this window; `None` if another window (or Tyset process) has it.
pub fn claim(path: &Path) -> io::Result<Option<Claim>> {
    let file = File::options().create(true).truncate(false).write(true).open(lock_path(path))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(Claim { path: path.to_path_buf(), lock: Some(file) })),
        Err(fs::TryLockError::WouldBlock) => Ok(None),
        Err(fs::TryLockError::Error(e)) => Err(e),
    }
}

/// Claim the most recently changed draft in `dir` that no window has open,
/// e.g. one left behind by a crash. Unclaimed empty drafts are deleted on the way.
pub fn recover(dir: &Path) -> Option<Claim> {
    let mut drafts: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| is_draft(dir, &entry.path()))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .collect();
    drafts.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in drafts {
        let Ok(Some(claim)) = claim(&path) else { continue };
        if fs::metadata(&path).is_ok_and(|m| m.len() > 0) {
            return Some(claim);
        }
        let _ = fs::remove_file(&path);
    }
    None
}

/// True for a (non-hidden) markdown file directly inside `dir`.
pub fn is_draft(dir: &Path, path: &Path) -> bool {
    path.parent() == Some(dir)
        && path.extension().is_some_and(|e| e == "md")
        && !path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

/// Write `contents` to `target` and delete the draft `from`. Writing the text
/// (rather than renaming) works across disks and keeps the target's permissions.
pub fn save_as(from: &Path, target: &Path, contents: &[u8]) -> io::Result<()> {
    files::atomic_write(target, contents)?;
    match fs::remove_file(from) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn new_paths_are_unique() {
        let dir = tempfile::tempdir().unwrap();
        let drafts = dir.path().join("drafts");
        let a = new_path(&drafts, "20260926-120000").unwrap();
        assert_eq!(a, drafts.join("Untitled-20260926-120000.md"));
        fs::write(&a, "x").unwrap();
        let b = new_path(&drafts, "20260926-120000").unwrap();
        assert_eq!(b, drafts.join("Untitled-20260926-120000-1.md"));
    }

    #[test]
    fn recover_takes_the_newest_unclaimed_draft() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let old = d.join("old.md");
        let new = d.join("new.md");
        let empty = d.join("empty.md");
        let open = d.join("open.md");
        for (path, text) in [(&old, "a"), (&new, "b"), (&empty, ""), (&open, "c")] {
            fs::write(path, text).unwrap();
        }
        let now = SystemTime::now();
        let touch = |p: &Path, t| fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
        touch(&old, now - Duration::from_secs(60));
        touch(&empty, now + Duration::from_secs(30));
        touch(&open, now + Duration::from_secs(60));

        let held = claim(&open).unwrap().unwrap();
        let first = recover(d).unwrap();
        assert_eq!(first.path, new);
        assert!(!empty.exists());
        assert_eq!(recover(d).unwrap().path, old); // `first` is still held
        assert!(recover(d).is_none_or(|c| c.path != open));

        // Releasing a claim removes its lock file and frees the draft.
        drop(held);
        assert!(!d.join(".open.md.lock").exists());
        assert_eq!(recover(d).unwrap().path, open);
        assert!(recover(&d.join("missing")).is_none());
        drop(first);
    }

    #[test]
    fn save_as_moves_the_text() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("draft.md");
        let other = tempfile::tempdir().unwrap();
        let target = other.path().join("Notes.md");
        fs::write(&from, "old").unwrap();
        save_as(&from, &target, b"latest").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "latest");
        assert!(!from.exists());
        // A draft that was never written (no text yet) can be saved too.
        save_as(&from, &target, b"again").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "again");
    }
}
