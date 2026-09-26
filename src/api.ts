// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export interface TreeNode {
  name: string;
  path: string;
  /** Present for directories, absent for files. */
  children?: TreeNode[];
}

export interface FsChange {
  paths: string[];
}

export const listTree = (root: string) => invoke<TreeNode[]>("list_tree", { root });

export const readFile = (path: string) => invoke<string>("read_file", { path });

export const writeFile = (path: string, contents: string) =>
  invoke<void>("write_file", { path, contents });

export const watchFolder = (root: string) => invoke<void>("watch_folder", { root });

/** A file path passed on the command line, if any (only for the first window). */
export const initialPath = () => invoke<string | null>("initial_path");

/** Changes under this window's watched folder (events are targeted per window). */
export const onFsChange = (handler: (change: FsChange) => void): Promise<UnlistenFn> =>
  getCurrentWebviewWindow().listen<FsChange>("fs-change", (event) => handler(event.payload));

/** Link an image file from `doc`, copying it into `assets/` if it is outside the doc's folder. */
export const importImageFile = (doc: string, source: string) =>
  invoke<string>("import_image_file", { doc, source });

/** Save a clipboard image as a PNG in `assets/` beside `doc`; null if the clipboard has no image. */
export const pasteClipboardImage = (doc: string) => invoke<string | null>("paste_clipboard_image", { doc });

export interface Snapshot {
  id: string;
  /** Milliseconds since the Unix epoch. */
  saved: number;
  size: number;
}

/** Earlier versions of `path` from local history, newest first. */
export const listHistory = (path: string) => invoke<Snapshot[]>("list_history", { path });

export const readHistory = (path: string, id: string) => invoke<string>("read_history", { path, id });

/** Watch the folder of a document outside the open folder; null stops watching. */
export const watchDocument = (path: string | null) => invoke<void>("watch_document", { path });

export const newWindow = () => invoke<void>("new_window");

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

/** Rename a file or folder within its folder; resolves to the new path. */
export const renamePath = (path: string, name: string) => invoke<string>("rename_path", { path, name });

/** Move a file or folder to the system trash. */
export const trashPath = (path: string) => invoke<void>("trash_path", { path });

/** A path for a new untitled document in the app's drafts folder (written on the first save). */
export const createDraft = () => invoke<string>("create_draft");

/** The newest draft no window has open (e.g. left by a crash), or null. */
export const recoverDraft = () => invoke<string | null>("recover_draft");

/** Write a draft's text to `target` and delete the draft. */
export const saveDraftAs = (path: string, target: string, contents: string) =>
  invoke<void>("save_draft_as", { path, target, contents });

/** Delete a draft the user chose not to keep. */
export const discardDraft = (path: string) => invoke<void>("discard_draft", { path });
