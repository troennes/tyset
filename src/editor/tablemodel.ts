// GFM pipe tables as data: parse, edit, and format as aligned markdown.

export type Align = "none" | "left" | "center" | "right";

export interface Table {
  /** Cell text as written in markdown (so `\|` stays escaped). */
  header: string[];
  align: Align[];
  rows: string[][];
}

const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

/** Split a table row on unescaped pipes; leading and trailing pipes are optional. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** True for the `| --- | :-: |` row under a table's header. */
export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : "none";
}

export function parseTable(text: string): Table {
  const lines = text.split(/\r\n?|\n/);
  const header = splitRow(lines[0] ?? "");
  const align = splitRow(lines[1] ?? "").map(alignOf);
  const width = header.length;
  const fit = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? "");
  return {
    header,
    align: Array.from({ length: width }, (_, i) => align[i] ?? "none"),
    rows: lines.slice(2).filter((l) => l.trim() !== "").map((l) => fit(splitRow(l))),
  };
}

/** Width as the eye sees it, counting code points rather than UTF-16 units. */
function width(text: string): number {
  return [...text].length;
}

function pad(text: string, size: number, align: Align): string {
  const gap = size - width(text);
  if (gap <= 0) return text;
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

function delimiter(size: number, align: Align): string {
  const dashes = (n: number) => "-".repeat(Math.max(1, n));
  switch (align) {
    case "left":
      return ":" + dashes(size - 1);
    case "right":
      return dashes(size - 1) + ":";
    case "center":
      return ":" + dashes(size - 2) + ":";
    default:
      return dashes(size);
  }
}

/** Format as an aligned pipe table, lines joined with `lineBreak`. */
export function formatTable(table: Table, lineBreak = "\n"): string {
  const columns = table.header.length;
  const sizes = Array.from({ length: columns }, (_, c) =>
    Math.max(3, width(table.header[c]), ...table.rows.map((r) => width(r[c] ?? ""))),
  );
  const row = (cells: string[]) =>
    "| " + sizes.map((size, c) => pad(cells[c] ?? "", size, table.align[c])).join(" | ") + " |";
  return [
    row(table.header),
    "| " + sizes.map((size, c) => delimiter(size, table.align[c])).join(" | ") + " |",
    ...table.rows.map(row),
  ].join(lineBreak);
}

/** Cell text for display/editing: `\|` becomes `|`. */
export function unescapeCell(text: string): string {
  return text.replace(/\\\|/g, "|");
}

/** Cell text for markdown: bare `|` becomes `\|`, line breaks become spaces. */
export function escapeCell(text: string): string {
  return text.replace(/\r\n?|\n/g, " ").replace(/(^|[^\\])\|/g, "$1\\|").replace(/(^|[^\\])\|/g, "$1\\|");
}

/** Row 0 is the header; body rows start at 1. */
export function cell(table: Table, row: number, column: number): string {
  return (row === 0 ? table.header : table.rows[row - 1])?.[column] ?? "";
}

export function withCell(table: Table, row: number, column: number, text: string): Table {
  if (row === 0) return { ...table, header: table.header.map((c, i) => (i === column ? text : c)) };
  return { ...table, rows: table.rows.map((r, i) => (i === row - 1 ? r.map((c, j) => (j === column ? text : c)) : r)) };
}

/** Insert an empty body row so that it becomes row number `at` (1-based). */
export function insertRow(table: Table, at: number): Table {
  const rows = [...table.rows];
  rows.splice(Math.max(0, at - 1), 0, table.header.map(() => ""));
  return { ...table, rows };
}

export function deleteRow(table: Table, row: number): Table {
  if (row < 1) return table; // the header can't be removed
  return { ...table, rows: table.rows.filter((_, i) => i !== row - 1) };
}

export function insertColumn(table: Table, at: number): Table {
  const add = <T>(cells: T[], value: T) => [...cells.slice(0, at), value, ...cells.slice(at)];
  return {
    header: add(table.header, ""),
    align: add(table.align, "none" as Align),
    rows: table.rows.map((r) => add(r, "")),
  };
}

export function deleteColumn(table: Table, column: number): Table {
  if (table.header.length <= 1) return table;
  const drop = <T>(cells: T[]) => cells.filter((_, i) => i !== column);
  return { header: drop(table.header), align: drop(table.align), rows: table.rows.map(drop) };
}

export function setAlign(table: Table, column: number, align: Align): Table {
  return { ...table, align: table.align.map((a, i) => (i === column ? align : a)) };
}

export function newTable(columns = 2, rows = 1): Table {
  return {
    header: Array.from({ length: columns }, (_, i) => `Column ${i + 1}`),
    align: Array.from({ length: columns }, () => "none" as Align),
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")),
  };
}
