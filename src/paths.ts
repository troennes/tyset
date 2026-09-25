// Path helpers that work for both Unix and Windows paths.

const SEPARATOR = /[\\/]/;

function separatorOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function baseName(path: string): string {
  return path.split(SEPARATOR).filter(Boolean).pop() ?? path;
}

export function dirName(path: string): string {
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  return dir || (/^[\\/]/.test(path) ? path[0] : path); // "/a.md" -> "/"
}

/** True for `C:\...`, `\\server\...` and `/...`. */
export function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
}

/** Resolve a relative link path (using `/`, possibly with `..`) against a directory. */
export function resolve(dir: string, rel: string): string {
  if (isAbsolute(rel)) return rel;
  const sep = separatorOf(dir);
  const parts = dir.split(SEPARATOR);
  for (const part of rel.split(SEPARATOR)) {
    if (part === "..") {
      if (parts.length > 1) parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }
  return parts.join(sep);
}
