//! Images added to a document: copied into an `assets/` folder beside it and
//! linked with a relative path.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub const ASSETS_DIR: &str = "assets";
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.iter().any(|i| i.eq_ignore_ascii_case(e)))
}

/// Link `source` from the document at `doc`. Files already under the document's
/// folder are linked where they are; others are copied into `assets/`.
/// Returns the link path, relative to the document and using `/`.
pub fn import_file(doc: &Path, source: &Path) -> io::Result<String> {
    let dir = doc_dir(doc);
    let source = fs::canonicalize(source)?;
    if let Ok(dir) = fs::canonicalize(dir) {
        if let Ok(rel) = source.strip_prefix(&dir) {
            return Ok(link_path(rel));
        }
    }
    let name = source.file_name().ok_or_else(|| invalid("source has no file name"))?;
    let contents = fs::read(&source)?;
    let target = store(dir, &name.to_string_lossy(), &contents)?;
    Ok(link_path(target.strip_prefix(dir).unwrap_or(&target)))
}

/// Save `contents` (e.g. a pasted screenshot) as `assets/<name>` next to `doc`.
pub fn import_bytes(doc: &Path, name: &str, contents: &[u8]) -> io::Result<String> {
    let dir = doc_dir(doc);
    let target = store(dir, name, contents)?;
    Ok(link_path(target.strip_prefix(dir).unwrap_or(&target)))
}

/// Write into `dir/assets/`, choosing `name`, `name-1`, ... so an existing,
/// different file is never overwritten. An identical existing file is reused.
fn store(dir: &Path, name: &str, contents: &[u8]) -> io::Result<PathBuf> {
    let name = sanitize(name);
    if !is_image(Path::new(&name)) {
        return Err(invalid("not an image"));
    }
    let assets = dir.join(ASSETS_DIR);
    fs::create_dir_all(&assets)?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) => (stem.to_string(), format!(".{ext}")),
        None => (name.clone(), String::new()),
    };
    for n in 0.. {
        let candidate = assets.join(if n == 0 { name.clone() } else { format!("{stem}-{n}{ext}") });
        match fs::read(&candidate) {
            Ok(existing) if existing == contents => return Ok(candidate),
            Ok(_) => continue,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                crate::files::atomic_write(&candidate, contents)?;
                return Ok(candidate);
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

/// Encode RGBA pixels (as read from the clipboard) as a PNG file.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, png::EncodingError> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(rgba)?;
    Ok(out)
}

/// UTC `YYYYMMDD-HHMMSS`, for naming pasted images.
pub fn timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_timestamp(secs)
}

fn format_timestamp(secs: u64) -> String {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn doc_dir(doc: &Path) -> &Path {
    doc.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."))
}

/// Keep only the final path component and drop characters that are awkward in links.
fn sanitize(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*()[]".contains(c) { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').trim();
    if cleaned.is_empty() { "image.png".into() } else { cleaned.into() }
}

/// A markdown link path: `/` separators, spaces percent-encoded.
fn link_path(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().replace('%', "%25").replace(' ', "%20")),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_images_are_copied_with_unique_names() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        let a = other.path().join("my shot.png");
        let b = other.path().join("sub");
        fs::create_dir(&b).unwrap();
        let b = b.join("my shot.png");
        fs::write(&a, b"one").unwrap();
        fs::write(&b, b"two").unwrap();

        assert_eq!(import_file(&doc, &a).unwrap(), "assets/my%20shot.png");
        // Same name, different content: numbered.
        assert_eq!(import_file(&doc, &b).unwrap(), "assets/my%20shot-1.png");
        // Same content again: reused, not duplicated.
        assert_eq!(import_file(&doc, &a).unwrap(), "assets/my%20shot.png");
        assert_eq!(fs::read_dir(dir.path().join(ASSETS_DIR)).unwrap().count(), 2);
    }

    #[test]
    fn images_inside_the_folder_are_linked_in_place() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("pics")).unwrap();
        let img = dir.path().join("pics/cat.jpg");
        fs::write(&img, b"cat").unwrap();
        assert_eq!(import_file(&dir.path().join("note.md"), &img).unwrap(), "pics/cat.jpg");
        assert!(!dir.path().join(ASSETS_DIR).exists());
    }

    #[test]
    fn timestamps() {
        assert_eq!(format_timestamp(0), "19700101-000000");
        assert_eq!(format_timestamp(951_782_400), "20000229-000000"); // leap day
        assert_eq!(format_timestamp(1_790_330_696), "20260925-100456");
        assert_eq!(timestamp().len(), 15);
    }

    #[test]
    fn encodes_png() {
        let png = encode_png(2, 1, &[255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn pasted_bytes_get_safe_names() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        assert_eq!(import_bytes(&doc, "../evil/<x>.png", b"x").unwrap(), "assets/-x-.png");
        assert!(import_bytes(&doc, "script.sh", b"x").is_err());
    }
}
