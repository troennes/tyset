//! Tauri commands: the page's only access to files, the clipboard and windows.

mod assets;
mod export;
mod files;
mod history;
mod watch;

use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use files::TreeNode;

#[derive(Default)]
struct AppState {
    /// Per window label: the open folder's watcher, and one for a document outside it.
    folder_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    document_watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    /// File passed on the command line; handed out once to the first window.
    initial_path: Mutex<Option<String>>,
    windows_opened: AtomicUsize,
}

type CommandResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// --- Files --------------------------------------------------------------------

#[tauri::command]
fn list_tree(root: String) -> CommandResult<Vec<TreeNode>> {
    files::list_tree(Path::new(&root)).map_err(err)
}

#[tauri::command]
fn read_file(app: AppHandle, path: String) -> CommandResult<String> {
    let contents = fs::read_to_string(&path).map_err(err)?;
    // Let the page show images stored beside the document.
    if let Some(dir) = Path::new(&path).parent() {
        allow_assets(&app, dir);
    }
    Ok(contents)
}

/// Write atomically, first keeping the previous contents in local history.
#[tauri::command]
fn write_file(app: AppHandle, path: String, contents: String) -> CommandResult<()> {
    let path = Path::new(&path);
    if let (Ok(old), Some(root)) = (fs::read(path), history_root(&app)) {
        if old != contents.as_bytes() {
            // History is a safety net: never fail a save because of it.
            let _ = history::snapshot(&root, &canonical(path), &old);
        }
    }
    files::atomic_write(path, contents.as_bytes()).map_err(err)
}

/// Create an empty file, or leave an existing one untouched.
#[tauri::command]
fn create_file(path: String) -> CommandResult<()> {
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(err(e)),
    }
}

/// Rename a file or folder in place; returns the new path. A file's local history moves with it.
#[tauri::command]
fn rename_path(app: AppHandle, path: String, name: String) -> CommandResult<String> {
    let from = Path::new(&path);
    let old_key = canonical(from);
    let target = files::rename(from, &name).map_err(err)?;
    if target.is_file() {
        if let Some(root) = history_root(&app) {
            let _ = history::relocate(&root, &old_key, &canonical(&target));
        }
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Move a file or folder to the system trash (never deletes permanently).
#[tauri::command]
fn trash_path(path: String) -> CommandResult<()> {
    trash::delete(&path).map_err(|e| format!("Could not move to the trash: {e}"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn initial_path(state: State<AppState>) -> Option<String> {
    state.initial_path.lock().unwrap().take()
}

// --- Local history --------------------------------------------------------------

fn history_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("history"))
}

/// History is keyed by the real path, so a file reached via a symlink shares it.
fn canonical(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[tauri::command]
fn list_history(app: AppHandle, path: String) -> CommandResult<Vec<history::Snapshot>> {
    let root = history_root(&app).ok_or("no app data directory")?;
    history::list(&root, &canonical(Path::new(&path))).map_err(err)
}

#[tauri::command]
fn read_history(app: AppHandle, path: String, id: String) -> CommandResult<String> {
    let root = history_root(&app).ok_or("no app data directory")?;
    history::read(&root, &canonical(Path::new(&path)), &id).map_err(err)
}

// --- Settings -----------------------------------------------------------------

fn settings_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app.path().app_config_dir().map_err(err)?.join("settings.json"))
}

/// The settings object; its shape is owned by the frontend (`src/settings.ts`).
#[tauri::command]
fn load_settings(app: AppHandle) -> CommandResult<serde_json::Value> {
    match fs::read_to_string(settings_path(&app)?) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(err(e)),
    }
}

/// Merge `changes` (top-level keys) into the stored settings. Merging rather than
/// replacing keeps one window from undoing another window's changes.
#[tauri::command]
fn update_settings(app: AppHandle, changes: serde_json::Map<String, serde_json::Value>) -> CommandResult<()> {
    let path = settings_path(&app)?;
    let mut settings = match load_settings(app)? {
        serde_json::Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    settings.extend(changes);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(err)?;
    files::atomic_write(&path, text.as_bytes()).map_err(err)
}

// --- Export -------------------------------------------------------------------

#[tauri::command]
fn render_markdown(markdown: String) -> String {
    export::render(&markdown)
}

/// Write an exported file (no local history: exports are generated, not edited).
#[tauri::command]
fn write_export(path: String, contents: String) -> CommandResult<()> {
    files::atomic_write(Path::new(&path), contents.as_bytes()).map_err(err)
}

/// Open the system print dialog for the calling window (where "Save as PDF" lives).
#[tauri::command]
fn print_page(window: WebviewWindow) -> CommandResult<()> {
    window.print().map_err(err)
}

// --- Images -------------------------------------------------------------------

/// Link an image file (e.g. dropped on the window) from `doc`, copying it into
/// `assets/` unless it is already inside the document's folder.
#[tauri::command]
fn import_image_file(doc: String, source: String) -> CommandResult<String> {
    if !assets::is_image(Path::new(&source)) {
        return Err(format!("Not an image: {source}"));
    }
    assets::import_file(Path::new(&doc), Path::new(&source)).map_err(err)
}

/// Save the image on the clipboard (e.g. a screenshot) as a PNG in `assets/`
/// beside `doc`. Returns the link, or `None` if the clipboard holds no image.
/// Read natively because WebKitGTK does not expose clipboard images to the page.
#[tauri::command]
fn paste_clipboard_image(doc: String) -> CommandResult<Option<String>> {
    let mut clipboard = arboard::Clipboard::new().map_err(err)?;
    let Ok(image) = clipboard.get_image() else { return Ok(None) };
    let png = assets::encode_png(image.width as u32, image.height as u32, &image.bytes).map_err(err)?;
    let name = format!("image-{}.png", assets::timestamp());
    assets::import_bytes(Path::new(&doc), &name, &png).map(Some).map_err(err)
}

fn allow_assets(app: &AppHandle, dir: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

// --- Watching and windows -------------------------------------------------------

/// Watch `root` recursively for the calling window, replacing its previous folder.
#[tauri::command]
fn watch_folder(window: WebviewWindow, state: State<AppState>, root: String) -> CommandResult<()> {
    let root = PathBuf::from(root);
    allow_assets(window.app_handle(), &root);
    let watcher = watch::watch(&window, &root, true).map_err(err)?;
    state.folder_watchers.lock().unwrap().insert(window.label().to_string(), watcher);
    Ok(())
}

/// Watch the folder of a document that is outside the open folder (`None` stops).
#[tauri::command]
fn watch_document(window: WebviewWindow, state: State<AppState>, path: Option<String>) -> CommandResult<()> {
    let mut watchers = state.document_watchers.lock().unwrap();
    watchers.remove(window.label());
    let Some(dir) = path.as_deref().and_then(|p| Path::new(p).parent()) else { return Ok(()) };
    let watcher = watch::watch(&window, dir, false).map_err(err)?;
    watchers.insert(window.label().to_string(), watcher);
    Ok(())
}

/// Open an empty window. Async: creating windows from a sync command can deadlock on Windows.
#[tauri::command]
async fn new_window(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    let n = state.windows_opened.fetch_add(1, Ordering::Relaxed) + 1;
    WebviewWindowBuilder::new(&app, format!("window-{n}"), WebviewUrl::App("index.html?blank".into()))
        .title("Tyset")
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 320.0)
        .build()
        .map_err(err)?;
    Ok(())
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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { initial_path: Mutex::new(cli_path()), ..Default::default() })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                state.folder_watchers.lock().unwrap().remove(window.label());
                state.document_watchers.lock().unwrap().remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_tree,
            read_file,
            write_file,
            create_file,
            path_exists,
            rename_path,
            trash_path,
            initial_path,
            list_history,
            read_history,
            load_settings,
            update_settings,
            import_image_file,
            paste_clipboard_image,
            render_markdown,
            write_export,
            print_page,
            watch_folder,
            watch_document,
            new_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tyset");
}
