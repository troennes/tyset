// Naming untitled documents when they are saved.

const MAX_NAME_LENGTH = 60;

/** A file name suggested by a document's first heading or line, e.g. "Meeting notes.md". */
export function suggestFileName(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() && !/^\s*(---+|```|~~~)/.test(line)) ?? "";
  const name = first
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)*/, "") // heading, quote, list markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images: keep the text
    .replace(/[*_`~]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ") // not allowed in file names on Windows
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[\s.]+$/, "");
  return `${name || "Untitled"}.md`;
}
