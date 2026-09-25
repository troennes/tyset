// App settings, stored as JSON in the app config directory (see load_settings in lib.rs).
import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  /** null follows the system. */
  theme: "light" | "dark" | null;
  sourceMode: boolean;
  sidebar: boolean;
  sidebarTab: "files" | "outline";
  /** Restored when the app starts. */
  folder: string | null;
  file: string | null;
}

const defaults: Settings = {
  theme: null,
  sourceMode: false,
  sidebar: true,
  sidebarTab: "files",
  folder: null,
  file: null,
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
