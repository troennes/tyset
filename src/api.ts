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
