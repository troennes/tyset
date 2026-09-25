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

/** Create an empty file; an existing file is left as it is. */
export const createFile = (path: string) => invoke<void>("create_file", { path });

/** Watch the folder of a document outside the open folder; null stops watching. */
export const watchDocument = (path: string | null) => invoke<void>("watch_document", { path });

export const newWindow = () => invoke<void>("new_window");

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

/** Rename a file or folder within its folder; resolves to the new path. */
export const renamePath = (path: string, name: string) => invoke<string>("rename_path", { path, name });

/** Move a file or folder to the system trash. */
export const trashPath = (path: string) => invoke<void>("trash_path", { path });
