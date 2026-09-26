// Blank lines between blocks, as Typora shows them. Typora has paragraphs, not lines: the
// space between blocks is a margin (preview.ts adds it), and pressing Enter makes a new,
// possibly empty, paragraph. In the file, one blank line separates two blocks and is hidden;
// an empty paragraph is an extra blank line with a separator on each side, so 3 blank lines
// show one empty paragraph and 5 show two. Arrow keys and clicks skip the hidden separators.
// Enter starts a new paragraph (two line breaks) and Shift+Enter a line break.
// Only decorations change here; the commands edit the document as normal keys do.
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Line, Prec, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

import { BOXED } from "./preview";

const hidden = Decoration.replace({});
/** An empty paragraph, with a paragraph's space. */
const emptyParagraph = Decoration.line({ class: "cm-block-end" });
/** Blank lines inside these are part of the content. */
const LITERAL = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

/** The top-level block at `pos` (which may be its start or end), if any. */
function topBlock(tree: Tree, pos: number): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    let node = tree.resolve(pos, side);
    if (!node.parent) continue;
    while (node.parent?.parent) node = node.parent;
    return node;
  }
  return null;
}

function literal(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (LITERAL.has(node.name)) return true;
  }
  return false;
}

/**
 * Whether blank line `k` of the run `n..end` is an empty paragraph. Between two blocks the
 * run starts and ends with a separator; at the end of the document it only starts with one,
 * and at the start it only ends with one (the first line then shows either way).
 */
function isEmptyParagraph(k: number, n: number, end: number, leading: boolean, trailing: boolean): boolean {
  if (leading) return k === 1 || (end - k) % 2 === 1;
  return (k - n) % 2 === 1 && (trailing || k < end);
}

/**
 * Each hidden range runs from the end of the last visible line to the end of the last hidden
 * one, so the separators fold into the line above. A blank line the cursor is on also shows,
 * so typing is never invisible. Two boxed blocks (code, quotes) with only a separator between
 * them keep it as a plain line, since their space can't be padding.
 */
function build(state: EditorState): DecorationSet {
  const { doc } = state;
  const tree = syntaxTree(state);
  const cursorLines = new Set(
    state.selection.ranges.flatMap((r) => [doc.lineAt(r.anchor).number, doc.lineAt(r.head).number]),
  );
  const blank = (n: number) => doc.line(n).text.trim() === "";
  const ranges = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (!blank(n)) continue;
    let end = n;
    while (end < doc.lines && blank(end + 1)) end++;
    const leading = n === 1;
    const trailing = end === doc.lines;
    if (!(leading && trailing) && !literal(tree, doc.line(n).from)) {
      const empty = (k: number) => isEmptyParagraph(k, n, end, leading, trailing);
      let keep = 0;
      if (!leading && !trailing) {
        const before = topBlock(tree, doc.line(n - 1).from);
        const after = topBlock(tree, doc.line(end + 1).from);
        const boxed = !!before && !!after && BOXED.has(before.name) && BOXED.has(after.name);
        if (boxed && end - n < 2) keep = end;
      }
      let shown = n - 1;
      for (let k = n; k <= end; k++) {
        if (!empty(k) && !cursorLines.has(k) && k !== keep) continue;
        if (k - 1 > shown) ranges.push(hidden.range(doc.line(shown).to, doc.line(k - 1).to));
        if (empty(k)) ranges.push(emptyParagraph.range(doc.line(k).from));
        shown = k;
      }
      if (end > shown) ranges.push(hidden.range(doc.line(shown).to, doc.line(end).to));
    }
    n = end;
  }
  return Decoration.set(ranges, true);
}

const hiddenBlankLines = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    return tr.docChanged || tr.selection || treeChanged ? build(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The hidden range whose lines `pos` is on (not its start, which is the visible line's end). */
function hiddenAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  state.field(hiddenBlankLines).between(pos, pos, (from, to) => {
    if (pos > from && pos <= to) found = { from, to };
  });
  return found;
}

/** `line` shows as an empty paragraph. */
function isEmptyLine(state: EditorState, line: Line): boolean {
  let found = false;
  state.field(hiddenBlankLines).between(line.from, line.from, (from, _to, value) => {
    if (from === line.from && value === emptyParagraph) found = true;
  });
  return found;
}

/**
 * A cursor moved onto hidden lines stops at the end of the visible line above them, where
 * End, a click past the text or Up/Down put it visually. Only stepping forward from that
 * line end (Right) goes on to the next block.
 */
const skipHidden = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || !tr.isUserEvent("select")) return tr;
  const old = tr.startState.selection;
  const pointer = tr.isUserEvent("select.pointer");
  let moved = false;
  const ranges = tr.newSelection.ranges.map((range, i) => {
    const skip = hiddenAt(tr.startState, range.head);
    if (!skip) return range;
    moved = true;
    // Past the last separator at the end of the document there is nothing to go on to.
    const onward = !pointer && (old.ranges[i] ?? old.main).head === skip.from && skip.to < tr.state.doc.length;
    const head = onward ? skip.to + 1 : skip.from;
    return range.empty ? EditorSelection.cursor(head) : EditorSelection.range(range.anchor, head);
  });
  if (!moved) return tr;
  return [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex), sequential: true }];
});

/**
 * Enter in a top-level paragraph or heading, or on an empty paragraph: start a new paragraph,
 * as Typora does. At the start of a paragraph, the new empty one goes above it.
 */
function newParagraph(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1) return false;
  const block = topBlock(syntaxTree(state), range.from);
  const inText = !!block && (block.name === "Paragraph" || /^ATXHeading/.test(block.name));
  if (!inText && !(range.empty && isEmptyLine(state, state.doc.lineAt(range.head)))) return false;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: state.lineBreak + state.lineBreak },
    selection: { anchor: range.from + 2 },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** Backspace or Delete on an empty paragraph: remove it with its separator. */
function removeEmpty(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(range.head);
    if (!isEmptyLine(state, line)) return false;
    const n = line.number;
    const blank = (k: number) => state.doc.line(k).text.trim() === "";
    let changes;
    if (!forward && n > 2 && blank(n - 1)) changes = { from: state.doc.line(n - 1).from - 1, to: line.from };
    else if (forward && n + 1 < state.doc.lines && blank(n + 1)) changes = { from: line.to, to: line.to + 2 };
    else return false;
    view.dispatch({
      changes,
      scrollIntoView: true,
      userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
  };
}

/** A list item with nothing after its marker (or checkbox). */
const EMPTY_ITEM = /^(\s*)(?:[-+*]|\d+[.)])(?: \[[ xX]\])?\s*$/;

/**
 * Enter on an empty list item, as Typora does. A nested item moves out a level; a top-level
 * one ends the list, and the cursor lands in a new paragraph below it, with separators around
 * it. The markdown keymap would only remove the marker, leaving a line that continues the
 * last item. Lists inside quotes are left to the markdown keymap.
 */
function endListItem(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const empty = EMPTY_ITEM.exec(line.text);
  const tree = syntaxTree(state);
  const block = topBlock(tree, line.from);
  if (!empty || !block || !/^(Bullet|Ordered)List$/.test(block.name)) return false;
  const item = tree.resolveInner(line.from + empty[1].length, 1).parent;
  const parent = item?.name === "ListItem" ? item.parent?.parent : null;
  let insert: string;
  if (parent?.name === "ListItem") {
    const mark = parent.getChild("ListMark");
    if (!mark) return false;
    const parentLine = state.doc.lineAt(parent.from);
    const indent = parentLine.text.slice(0, parent.from - parentLine.from);
    const number = /^(\d+)([.)])$/.exec(state.sliceDoc(mark.from, mark.to));
    insert = `${indent}${number ? `${Number(number[1]) + 1}${number[2]}` : state.sliceDoc(mark.from, mark.to)} `;
  } else {
    const br = state.lineBreak;
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    insert = next && next.text.trim() !== "" ? br + br : br;
  }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    // After the marker, or on the new paragraph's line.
    selection: { anchor: line.from + (parent?.name === "ListItem" ? insert.length : 1) },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function lineBreak(view: EditorView): boolean {
  view.dispatch(view.state.replaceSelection(view.state.lineBreak), { scrollIntoView: true, userEvent: "input" });
  return true;
}

/**
 * Backspace at the start of a block, or Delete at the end of one, with hidden blank lines in
 * between: join the two blocks, instead of deleting a line break you can't see.
 */
function join(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty || state.selection.ranges.length > 1) return false;
    const skip = forward ? hiddenAt(state, range.head + 1) : hiddenAt(state, range.head - 1);
    if (!skip || (forward ? skip.from !== range.head : skip.to + 1 !== range.head)) return false;
    view.dispatch({
      changes: { from: skip.from, to: skip.to + 1 },
      selection: { anchor: skip.from },
      scrollIntoView: true,
      userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
  };
}

export const blankLines: Extension = [
  hiddenBlankLines,
  skipHidden,
  // Before the markdown keymap (also high precedence, and earlier in the configuration), which
  // still continues lists and quotes on Enter.
  Prec.highest(
    keymap.of([
      { key: "Enter", run: (view) => endListItem(view) || newParagraph(view) },
      { key: "Shift-Enter", run: lineBreak },
      { key: "Backspace", run: (view) => removeEmpty(false)(view) || join(false)(view) },
      { key: "Delete", run: (view) => removeEmpty(true)(view) || join(true)(view) },
    ]),
  ),
];
