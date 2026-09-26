// Blank lines between blocks are hidden, as in Typora, where the space between blocks is a
// margin (preview.ts adds it) rather than an empty line. A blank line with the cursor on it
// stays visible, so there is somewhere to type; arrow keys and clicks skip the hidden ones.
// Enter starts a new paragraph (a blank line in the file) and Shift+Enter a line break.
// Only decorations change here; the commands edit the document as normal keys do.
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, Prec, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

import { BOXED } from "./preview";

const hidden = Decoration.replace({});
/** The blank line being typed on looks like an empty paragraph, with a paragraph's space. */
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
 * Each hidden range runs from the end of the last visible line to the end of the last hidden
 * one, so the blank lines fold into the line above. Runs at the start or end of the document
 * stay, as does the last blank line between two boxed blocks (code, quotes), whose space
 * can't be padding.
 */
function build(state: EditorState): DecorationSet {
  const { doc } = state;
  const tree = syntaxTree(state);
  const cursorLines = new Set(
    state.selection.ranges.flatMap((r) => [doc.lineAt(r.anchor).number, doc.lineAt(r.head).number]),
  );
  const blank = (n: number) => doc.line(n).text.trim() === "";
  const ranges = [];
  for (let n = 2; n < doc.lines; n++) {
    if (!blank(n)) continue;
    let end = n;
    while (end < doc.lines && blank(end + 1)) end++;
    if (end < doc.lines && !literal(tree, doc.line(n).from)) {
      const before = topBlock(tree, doc.line(n - 1).from);
      const after = topBlock(tree, doc.line(end + 1).from);
      const keepLast = !!before && !!after && BOXED.has(before.name) && BOXED.has(after.name);
      let shown = n - 1;
      for (let k = n; k <= end; k++) {
        const typing = cursorLines.has(k);
        if (!typing && !(keepLast && k === end)) continue;
        if (k - 1 > shown) ranges.push(hidden.range(doc.line(shown).to, doc.line(k - 1).to));
        if (typing) ranges.push(emptyParagraph.range(doc.line(k).from));
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
    const onward = !pointer && (old.ranges[i] ?? old.main).head === skip.from;
    const head = onward ? Math.min(skip.to + 1, tr.state.doc.length) : skip.from;
    return range.empty ? EditorSelection.cursor(head) : EditorSelection.range(range.anchor, head);
  });
  if (!moved) return tr;
  return [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex), sequential: true }];
});

/** Enter in a top-level paragraph or heading: start a new paragraph, as Typora does. */
function newParagraph(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (state.selection.ranges.length > 1) return false;
  const block = topBlock(syntaxTree(state), range.from);
  if (!block || (block.name !== "Paragraph" && !/^ATXHeading/.test(block.name))) return false;
  const breaks = state.lineBreak + state.lineBreak;
  // At the very start, the new empty paragraph goes above, with the cursor in it.
  const atStart = range.empty && range.from === block.from;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: breaks },
    selection: { anchor: atStart ? range.from : range.from + 2 },
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
      { key: "Enter", run: newParagraph },
      { key: "Shift-Enter", run: lineBreak },
      { key: "Backspace", run: join(false) },
      { key: "Delete", run: join(true) },
    ]),
  ),
];
