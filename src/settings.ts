// App settings, stored as JSON in the app config directory (see load_settings in lib.rs).
import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  /** null follows the system. */
  theme: "light" | "dark" | null;
  sourceMode: boolean;
  sidebar: boolean;
  sidebarTab: "files" | "outline";
  /** The last opened folder: where Save As starts when no folder is open. */
  folder: string | null;
  /** Files opened on their own (not from the tree) and folders opened explicitly, newest first. */
  recentFiles: string[];
  recentFolders: string[];
}

const defaults: Settings = {
  theme: null,
  sourceMode: false,
  sidebar: true,
  sidebarTab: "files",
  folder: null,
  recentFiles: [],
  recentFolders: [],
};

const SAVE_DELAY_MS = 300;

let current: Settings = { ...defaults };
/** Changes not yet written; only these keys are sent, so windows don't overwrite each other. */
let pending: Partial<Settings> = {};
let timer: number | undefined;

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await invoke<Partial<Settings> | null>("load_settings");
    current = { ...defaults, ...(stored ?? {}) };
  } catch {
    current = { ...defaults }; // unreadable settings must not stop the app
  }
  return current;
}

/**
 * Change one setting based on its stored value rather than this window's copy,
 * so windows add to each other's lists (e.g. recent files) instead of replacing them.
 */
export async function updateStoredSetting<K extends keyof Settings>(
  key: K,
  change: (value: Settings[K]) => Settings[K],
): Promise<void> {
  await flushSettings();
  const value = (await storedSettings())[key];
  updateSettings({ [key]: change(value) } as Partial<Settings>);
}

/** Settings as last written by any window, without changing this window's copy. */
export async function storedSettings(): Promise<Settings> {
  try {
    const stored = await invoke<Partial<Settings> | null>("load_settings");
    return { ...current, ...pending, ...(stored ?? {}) };
  } catch {
    return current;
  }
}

export function settings(): Readonly<Settings> {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  pending = { ...pending, ...patch };
  window.clearTimeout(timer);
  timer = window.setTimeout(flushSettings, SAVE_DELAY_MS);
}

/** Write pending changes now (e.g. before the window closes). */
export async function flushSettings(): Promise<void> {
  window.clearTimeout(timer);
  const changes = pending;
  pending = {};
  if (Object.keys(changes).length) await invoke("update_settings", { changes }).catch(() => undefined);
}
