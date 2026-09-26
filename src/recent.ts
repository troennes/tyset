// Recently opened files and folders, newest first (stored in settings).

export const RECENT_LIMIT = 10;

/** Move `path` to the front of `list`, dropping duplicates and anything past the limit. */
export function addRecent(list: readonly string[], path: string, limit = RECENT_LIMIT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, limit);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path);
}

/** A folder for display, with the home directory shortened to `~`. */
export function displayDir(dir: string, home: string | null): string {
  if (!home) return dir;
  const trimmed = home.replace(/[\\/]+$/, "");
  if (dir === trimmed) return "~";
  if (dir.startsWith(trimmed) && /[\\/]/.test(dir.charAt(trimmed.length))) return "~" + dir.slice(trimmed.length);
  return dir;
}
