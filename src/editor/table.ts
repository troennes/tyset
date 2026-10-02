// Table grid editor: GFM tables drawn as a real <table> whose cells you edit in
// place, like Typora. Every edit rewrites that table's markdown as an aligned
// pipe table; nothing outside the table is touched.
import { redo, undo } from "@codemirror/commands";
import { type EditorState, type Extension, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";

import type { EditorHost } from "./host";
import { autolinkHref, linkTitle } from "./links";
import {
  type Align,
  type Table,
  cell,
  deleteColumn,
  deleteRow,
  escapeCell,
  formatTable,
  insertColumn,
  insertRow,
  isDelimiterRow,
  newTable,
  parseTable,
  setAlign,
  splitRow,
  unescapeCell,
  withCell,
} from "./tablemodel";

// --- Finding tables ---------------------------------------------------------------

interface TableRange {
  from: number;
  to: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
/** Starts a new block, which ends a table (GFM); any other non-blank line is another row. */
const BLOCK_START = /^\s*(#{1,6}(\s|$)|>|`{3,}|~{3,}|[-*+]\s|\d+[.)]\s|<)/;
/** Tables nested in quotes, lists or indented code stay as plain text. */
const NESTED = /^(\s{4,}|\s*[>*+-]\s|\s*\d+[.)]\s)/;

/** Top-level pipe tables, by line scan (skipping fenced code). */
export function findTables(state: EditorState): TableRange[] {
  const { doc } = state;
  const found: TableRange[] = [];
  let fence: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    const fenceMatch = FENCE.exec(text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (n === doc.lines || !text.includes("|") || NESTED.test(text)) continue;
    const next = doc.line(n + 1).text;
    if (!isDelimiterRow(next) || splitRow(next).length !== splitRow(text).length) continue;
    let last = n + 1;
    while (last < doc.lines) {
      const row = doc.line(last + 1).text;
      if (row.trim() === "" || BLOCK_START.test(row)) break;
      last++;
    }
    found.push({ from: doc.line(n).from, to: doc.line(last).to });
    n = last;
  }
  return found;
}

function tableAt(state: EditorState, pos: number): TableRange | null {
  return state.field(tables).ranges.find((t) => pos >= t.from && pos <= t.to) ?? null;
}

// --- Per-table DOM state -----------------------------------------------------------

interface Grid {
  view: EditorView;
  host: EditorHost;
  table: Table;
  /** Markdown this DOM shows; lets updateDOM tell our own edits from others (e.g. undo). */
  text: string;
  focus: { row: number; column: number } | null;
  /** Cell to focus after the next render (e.g. after adding a row). */
  pendingFocus: { row: number; column: number; select?: boolean } | null;
}

const grids = new WeakMap<HTMLElement, Grid>();

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly host: EditorHost,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-table";
    grids.set(wrapper, {
      view,
      host: this.host,
      table: parseTable(this.text),
      text: this.text,
      focus: null,
      pendingFocus: takePendingFocus(view, this.text),
    });
    wrapper.addEventListener("keydown", (e) => keydown(wrapper, e));
    wrapper.addEventListener("input", (e) => input(wrapper, e));
    wrapper.addEventListener("paste", (e) => paste(e));
    wrapper.addEventListener("focusin", (e) => focusin(wrapper, e));
    wrapper.addEventListener("focusout", (e) => focusout(wrapper, e));
    wrapper.addEventListener("mousedown", (e) => mousedown(wrapper, e));
    render(wrapper);
    return wrapper;
  }

  /** Reuse the DOM: keep it as is after our own edits, redraw after anything else. */
  updateDOM(dom: HTMLElement): boolean {
    const grid = grids.get(dom);
    if (!grid) return false;
    if (grid.text !== this.text) {
      grid.table = parseTable(this.text);
      grid.text = this.text;
      if (!grid.pendingFocus && grid.focus && dom.contains(document.activeElement)) {
        grid.pendingFocus = { ...grid.focus };
      }
      render(dom);
    }
    return true;
  }

  ignoreEvent(): boolean {
    return true; // the grid handles its own keys and clicks
  }

  get estimatedHeight(): number {
    return (this.text.split("\n").length - 1) * 38;
  }
}

// A table just inserted by Ctrl+T wants its first cell focused once drawn.
let pendingInsert: { text: string } | null = null;

function takePendingFocus(_view: EditorView, text: string): Grid["pendingFocus"] {
  if (pendingInsert?.text !== text) return null;
  pendingInsert = null;
  return { row: 0, column: 0, select: true };
}

// --- Rendering -------------------------------------------------------------------

const ALIGN_CSS: Record<Align, string> = { none: "", left: "left", center: "center", right: "right" };

function render(wrapper: HTMLElement): void {
  const grid = grids.get(wrapper)!;
  const { table } = grid;
  const el = document.createElement("table");
  const head = el.createTHead().insertRow();
  table.header.forEach((text, column) => head.append(cellElement("th", text, 0, column, table.align[column])));
  const body = el.createTBody();
  table.rows.forEach((row, r) => {
    const tr = body.insertRow();
    row.forEach((text, column) => tr.append(cellElement("td", text, r + 1, column, table.align[column])));
  });
  wrapper.replaceChildren(toolbar(), el);

  const target = grid.pendingFocus;
  grid.pendingFocus = null;
  // A new widget isn't in the page yet during toDOM, so focus on the next frame.
  if (target) requestAnimationFrame(() => focusCell(wrapper, target.row, target.column, target.select ? "all" : "end"));
}

function cellElement(tag: "th" | "td", text: string, row: number, column: number, align: Align): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.row = String(row);
  el.dataset.column = String(column);
  el.contentEditable = "plaintext-only";
  el.spellcheck = false;
  if (align !== "none") el.style.textAlign = ALIGN_CSS[align];
  el.innerHTML = renderInline(text);
  return el;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** [text](url), <autolink>, bare URL (GFM drops trailing punctuation) or bare email. */
const CELL_LINK =
  /\[([^\]]+)\]\(([^)\s]+)\)|<((?:https?|mailto):[^\s<>]+|[^\s<>@]+@[^\s<>@]+)>|((?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:*_~'")\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;

const formatInline = (s: string) =>
  escapeHtml(s)
    .replace(/(\*\*|__)(?=\S)(.+?)\1/g, "<strong>$2</strong>")
    .replace(/(\*|_)(?=\S)(.+?)\1/g, "<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");

/** Inline markdown with links. Links are swapped out first so emphasis can't reach into a URL. */
function formatWithLinks(s: string): string {
  const links: string[] = [];
  const text = s.replace(CELL_LINK, (_, label?: string, url?: string, auto?: string, bare?: string) => {
    const href = url ?? autolinkHref(auto ?? bare!);
    const attr = escapeHtml(href);
    const content = label === undefined ? escapeHtml(auto ?? bare!) : formatInline(label);
    // No real href: WebKit would also navigate on Ctrl+click, opening the link twice.
    links.push(`<a data-href="${attr}" title="${escapeHtml(linkTitle(href))}">${content}</a>`);
    return `\0${links.length - 1}\0`;
  });
  return formatInline(text).replace(/\0(\d+)\0/g, (_, i: string) => links[Number(i)]);
}

/** Minimal inline markdown for cells that aren't being edited. */
export function renderInline(markdown: string): string {
  return unescapeCell(markdown)
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : formatWithLinks(part)))
    .join("");
}

function toolbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "cm-table-toolbar";
  const button = (action: string, label: string, title: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = action;
    b.textContent = label;
    b.title = title;
    return b;
  };
  bar.append(
    button("row-above", "+ Row ↑", "Insert row above"),
    button("row-below", "+ Row ↓", "Insert row below (Ctrl+Enter)"),
    button("col-left", "+ Col ←", "Insert column left"),
    button("col-right", "+ Col →", "Insert column right"),
    button("delete-row", "− Row", "Delete row (Ctrl+Shift+Backspace)"),
    button("delete-col", "− Col", "Delete column"),
    button("align-left", "Left", "Align column left (click again to clear)"),
    button("align-center", "Centre", "Align column centre (click again to clear)"),
    button("align-right", "Right", "Align column right (click again to clear)"),
    button("delete-table", "Delete table", "Delete the whole table"),
  );
  return bar;
}

// --- Focus and caret --------------------------------------------------------------

function cellAt(wrapper: HTMLElement, row: number, column: number): HTMLElement | null {
  return wrapper.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`);
}

function focusCell(wrapper: HTMLElement, row: number, column: number, caret: "start" | "end" | "all"): void {
  const el = cellAt(wrapper, row, column);
  if (!el) return;
  el.focus(); // focusin swaps in the raw text before the caret is placed
  const range = document.createRange();
  range.selectNodeContents(el);
  if (caret !== "all") range.collapse(caret === "start");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Where the caret is within a cell's text, if the selection is collapsed. */
function caretOffset(el: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
}

function position(e: Event): { row: number; column: number; el: HTMLElement } | null {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
  return el ? { row: Number(el.dataset.row), column: Number(el.dataset.column), el } : null;
}

function focusin(wrapper: HTMLElement, e: FocusEvent): void {
  const grid = grids.get(wrapper)!;
  const at = position(e);
  if (!at) return;
  grid.focus = { row: at.row, column: at.column };
  // Edit the raw markdown of this cell.
  at.el.textContent = unescapeCell(cell(grid.table, at.row, at.column));
  wrapper.classList.add("cm-table-active");
}

function focusout(wrapper: HTMLElement, e: FocusEvent): void {
  const grid = grids.get(wrapper)!;
  const at = position(e);
  if (at) at.el.innerHTML = renderInline(cell(grid.table, at.row, at.column));
  if (!wrapper.contains(e.relatedTarget as Node | null)) {
    wrapper.classList.remove("cm-table-active");
    grid.focus = null;
  }
}

// --- Editing ---------------------------------------------------------------------

/** Write `table` into the document in place of this table's markdown. */
function commit(wrapper: HTMLElement, table: Table | null, keepDom: boolean): void {
  const grid = grids.get(wrapper)!;
  const { view } = grid;
  const range = tableAt(view.state, view.posAtDOM(wrapper));
  if (!range) return;
  const text = table ? formatTable(table, view.state.lineBreak) : "";
  if (table) grid.table = table;
  // updateDOM then leaves the DOM (and the caret) alone. Widgets hold LF text.
  if (keepDom) grid.text = text.replace(/\r\n/g, "\n");
  let to = range.to;
  if (!table) {
    // Deleting the table: take its line break too, and one of the blank lines
    // around it if there are blank lines on both sides.
    const { doc, lineBreak } = view.state;
    to = Math.min(doc.length, range.to + lineBreak.length);
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    const blankBefore = first > 1 && doc.line(first - 1).text.trim() === "";
    const blankAfter = last < doc.lines && doc.line(last + 1).text.trim() === "";
    if (blankBefore && blankAfter) to = Math.min(doc.length, doc.line(last + 1).to + lineBreak.length);
  }
  view.dispatch({
    changes: { from: range.from, to, insert: text },
    ...(table ? {} : { selection: { anchor: range.from } }),
    userEvent: "input.table",
  });
  if (!table) view.focus();
}

function input(wrapper: HTMLElement, e: Event): void {
  const grid = grids.get(wrapper)!;
  const at = position(e);
  if (!at) return;
  commit(wrapper, withCell(grid.table, at.row, at.column, escapeCell(at.el.textContent ?? "")), true);
}

function paste(e: ClipboardEvent): void {
  // Cells are single-line plain text.
  e.preventDefault();
  const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?|\n/g, " ");
  document.execCommand("insertText", false, text);
}

/** Apply a structural change and put the caret at (row, column) afterwards. */
function restructure(wrapper: HTMLElement, table: Table, row: number, column: number): void {
  const grid = grids.get(wrapper)!;
  const rows = table.rows.length;
  const columns = table.header.length;
  grid.pendingFocus = { row: Math.max(0, Math.min(row, rows)), column: Math.max(0, Math.min(column, columns - 1)) };
  commit(wrapper, table, false);
}

function run(wrapper: HTMLElement, action: string): void {
  const grid = grids.get(wrapper)!;
  const { row, column } = grid.focus ?? { row: 0, column: 0 };
  const t = grid.table;
  switch (action) {
    case "row-above":
      return restructure(wrapper, insertRow(t, Math.max(1, row)), Math.max(1, row), column);
    case "row-below":
      return restructure(wrapper, insertRow(t, row + 1), row + 1, column);
    case "col-left":
      return restructure(wrapper, insertColumn(t, column), row, column);
    case "col-right":
      return restructure(wrapper, insertColumn(t, column + 1), row, column + 1);
    case "delete-row":
      if (row === 0) return; // the header row can't be removed
      return restructure(wrapper, deleteRow(t, row), row - 1 || (t.rows.length > 1 ? 1 : 0), column);
    case "delete-col":
      if (t.header.length <= 1) return;
      return restructure(wrapper, deleteColumn(t, column), row, column - 1 < 0 ? 0 : column - 1);
    case "align-left":
    case "align-center":
    case "align-right": {
      const align = action.slice("align-".length) as Align;
      return restructure(wrapper, setAlign(t, column, t.align[column] === align ? "none" : align), row, column);
    }
    case "delete-table":
      return commit(wrapper, null, false);
  }
}

function mousedown(wrapper: HTMLElement, e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (action) {
    e.preventDefault(); // keep the caret in the cell
    run(wrapper, action);
    return;
  }
  const link = target.closest<HTMLElement>("a[data-href]");
  if (link && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    grids.get(wrapper)!.host.openLink(link.dataset.href!);
  }
}

// --- Keyboard ------------------------------------------------------------------------

function keydown(wrapper: HTMLElement, e: KeyboardEvent): void {
  const grid = grids.get(wrapper)!;
  const at = position(e);
  if (!at) return;
  const { row, column, el } = at;
  const rows = grid.table.rows.length; // body rows; row numbers run 0..rows
  const columns = grid.table.header.length;
  const mod = e.ctrlKey || e.metaKey;
  const handled = () => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
    handled(); // the document's undo, not the cell's
    (e.key === "y" || e.shiftKey ? redo : undo)(grid.view);
    return;
  }
  if (mod && e.key === "Enter") {
    handled();
    run(wrapper, "row-below");
    return;
  }
  if (mod && e.shiftKey && e.key === "Backspace") {
    handled();
    run(wrapper, "delete-row");
    return;
  }
  if (mod && !e.shiftKey && ["b", "i", "'", "`"].includes(e.key)) {
    handled();
    const mark = e.key === "b" ? "**" : e.key === "i" ? "*" : "`";
    const selected = window.getSelection()?.toString() ?? "";
    document.execCommand("insertText", false, mark + selected + mark);
    return;
  }

  switch (e.key) {
    case "Tab": {
      handled();
      const index = row * columns + column + (e.shiftKey ? -1 : 1);
      if (index < 0) return;
      if (index > rows * columns + columns - 1) {
        restructure(wrapper, insertRow(grid.table, rows + 1), rows + 1, 0); // Tab past the end adds a row
        return;
      }
      focusCell(wrapper, Math.floor(index / columns), index % columns, "all");
      return;
    }
    case "Enter":
      handled();
      if (row < rows) focusCell(wrapper, row + 1, column, "end");
      else restructure(wrapper, insertRow(grid.table, rows + 1), rows + 1, column);
      return;
    case "ArrowUp":
      handled();
      if (row > 0) focusCell(wrapper, row - 1, column, "end");
      else leave(wrapper, "before");
      return;
    case "ArrowDown":
      handled();
      if (row < rows) focusCell(wrapper, row + 1, column, "end");
      else leave(wrapper, "after");
      return;
    case "ArrowLeft":
      if (e.shiftKey || caretOffset(el) !== 0) return;
      handled();
      if (column > 0) focusCell(wrapper, row, column - 1, "end");
      else if (row > 0) focusCell(wrapper, row - 1, columns - 1, "end");
      else leave(wrapper, "before");
      return;
    case "ArrowRight":
      if (e.shiftKey || caretOffset(el) !== (el.textContent ?? "").length) return;
      handled();
      if (column < columns - 1) focusCell(wrapper, row, column + 1, "start");
      else if (row < rows) focusCell(wrapper, row + 1, 0, "start");
      else leave(wrapper, "after");
      return;
    case "Escape":
      handled();
      leave(wrapper, "after");
      return;
  }
}

/** Put the editor's cursor on the line before or after the table. */
function leave(wrapper: HTMLElement, where: "before" | "after"): void {
  const { view } = grids.get(wrapper)!;
  const range = tableAt(view.state, view.posAtDOM(wrapper));
  if (!range) return;
  const { doc, lineBreak } = view.state;
  view.focus();
  if (where === "before") {
    if (range.from > 0) view.dispatch({ selection: { anchor: range.from - 1 }, scrollIntoView: true });
    else view.dispatch({ changes: { from: 0, insert: lineBreak }, selection: { anchor: 0 } });
    return;
  }
  if (range.to < doc.length) {
    view.dispatch({ selection: { anchor: range.to + lineBreak.length }, scrollIntoView: true });
  } else {
    // Table at the end: add a line to type on, as Typora does.
    view.dispatch({ changes: { from: range.to, insert: lineBreak }, selection: { anchor: range.to + lineBreak.length } });
  }
}

// --- Entering from the text ------------------------------------------------------------

function focusTable(view: EditorView, range: TableRange, where: "first" | "last"): void {
  const wrapper = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-table")].find(
    (el) => view.posAtDOM(el) === range.from,
  );
  const grid = wrapper && grids.get(wrapper);
  if (wrapper && grid) focusCell(wrapper, where === "first" ? 0 : grid.table.rows.length, 0, "end");
}

/**
 * Up/Down would jump over a table (block widgets are skipped by cursor motion),
 * so step into its nearest row instead. Uses the editor's own vertical motion,
 * so wrapped lines still move line by line.
 */
function arrowInto(forward: boolean) {
  return (view: EditorView): boolean => {
    const selection = view.state.selection.main;
    if (!selection.empty) return false;
    const target = view.moveVertically(selection, forward).head;
    const [low, high] = forward ? [selection.head, target] : [target, selection.head];
    const range = view.state
      .field(tables)
      .ranges.find((t) => (t.from > low && t.from <= high) || (t.to >= low && t.to < high) || (low >= t.from && low <= t.to));
    if (!range || tableAt(view.state, selection.head) === range) return false;
    focusTable(view, range, forward ? "first" : "last");
    return true;
  };
}

/**
 * Typing on the blank line right under a table would make that line a table row
 * (GFM continues tables until a blank line), so the text would vanish into the
 * grid. Keep it a paragraph by adding a separating blank line first.
 */
const keepParagraphAfterTable = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || text.includes("\n")) return false;
  const { doc, lineBreak } = view.state;
  const line = doc.lineAt(from);
  if (line.text !== "" || line.number === 1) return false;
  const endsTable = view.state.field(tables).ranges.some((t) => t.to === doc.line(line.number - 1).to);
  if (!endsTable) return false;
  view.dispatch({
    changes: { from, insert: lineBreak + text },
    selection: { anchor: from + lineBreak.length + text.length },
    userEvent: "input.type",
  });
  return true;
});

const enterTables = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: arrowInto(true) },
    { key: "ArrowUp", run: arrowInto(false) },
  ]),
);

// --- Commands and extension ---------------------------------------------------------

/** Ctrl+T: insert a new table as its own block and start editing its first cell. */
export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const { doc, lineBreak: br } = state;
  const line = doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === "";
  const text = formatTable(newTable(), br);
  // On an empty line, replace it; otherwise add the table after the current paragraph line.
  const from = empty ? line.from : line.to;
  const previousBlank = line.number === 1 || doc.line(line.number - 1).text.trim() === "";
  const before = !empty ? br + br : previousBlank ? "" : br;
  // Keep a blank line after the table, or a line to type on at the end of the document.
  const next = line.number < doc.lines ? doc.line(line.number + 1).text : null;
  const after = next === null ? br : next.trim() === "" ? "" : br;
  pendingInsert = { text: text.replace(/\r\n/g, "\n") };
  view.dispatch({
    changes: { from, to: line.to, insert: before + text + after },
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

const tables = StateField.define<{ ranges: TableRange[] }>({
  create: (state) => ({ ranges: findTables(state) }),
  update: (value, tr) => (tr.docChanged ? { ranges: findTables(tr.state) } : value),
});

function tableDecorations(host: EditorHost) {
  // Block widgets must come from a state field, not a view plugin.
  return StateField.define<DecorationSet>({
    create: (state) => build(state, host),
    update: (decorations, tr) => (tr.docChanged ? build(tr.state, host) : decorations),
    provide: (field) => EditorView.decorations.from(field),
  });
}

function build(state: EditorState, host: EditorHost): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of state.field(tables).ranges) {
    const text = state.sliceDoc(from, to).replace(/\r\n/g, "\n");
    builder.add(from, to, Decoration.replace({ widget: new TableWidget(text, host), block: true }));
  }
  return builder.finish();
}

/** The table field is always present (commands need it); the grid only in live preview. */
export const tableState: Extension = tables;
export function tableGrid(host: EditorHost): Extension {
  return [tableDecorations(host), enterTables, keepParagraphAfterTable];
}
