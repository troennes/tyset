// Wrapped lines in a list keep the indentation of the line they belong to, so a nested
// item wraps under its own bullet instead of at the left edge. Each list line gets a
// hanging indent (--wrap-indent, styled in theme.ts) as wide as its leading spaces.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const LISTS = new Set(["BulletList", "OrderedList"]);

/** A list that isn't inside another list, so each line is handled once. */
export function isOuterList(node: SyntaxNode): boolean {
  if (!LISTS.has(node.name)) return false;
  for (let at = node.parent; at; at = at.parent) if (LISTS.has(at.name)) return false;
  return true;
}

/**
 * Call `f` for each line of `list` in from..to that is indented, with the start of its
 * indentation (after the quote markers of the blockquotes the list is in) and its end.
 * Inside a code block only the list's own indentation counts.
 */
export function listLines(
  state: EditorState,
  list: SyntaxNode,
  from: number,
  to: number,
  f: (line: Line, start: number, end: number) => void,
): void {
  const { doc } = state;
  const tree = syntaxTree(state);
  let quotes = 0;
  for (let at = list.parent; at; at = at.parent) if (at.name === "Blockquote") quotes++;
  const prefix = new RegExp(`^(?: {0,3}> ?){0,${quotes}}( *)`);
  const first = doc.lineAt(Math.max(list.from, from)).number;
  const last = doc.lineAt(Math.min(list.to, to)).number;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const match = prefix.exec(line.text)!;
    let end = line.from + match[0].length;
    const start = end - match[1].length;
    if (end === line.from) continue;
    for (let at: SyntaxNode | null = tree.resolveInner(end, 1); at; at = at.parent) {
      if (at.name === "FencedCode" || at.name === "CodeBlock") {
        if (at.from < line.from) end = Math.min(end, line.from + (at.from - doc.lineAt(at.from).from));
        break;
      }
    }
    f(line, Math.min(start, end), end);
  }
}

const decorations = new Map<string, Decoration>();
/** Line decoration for a hanging indent of `width` (a CSS length). */
export function wrapIndentLine(width: string): Decoration {
  let deco = decorations.get(width);
  if (!deco) {
    deco = Decoration.line({ class: "cm-wrap-indent", attributes: { style: `--wrap-indent: ${width}` } });
    decorations.set(width, deco);
  }
  return deco;
}

/** Source mode: everything is monospace, so the indent is the line's prefix in `ch`. */
function build(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(ref) {
        if (!isOuterList(ref.node)) return true;
        listLines(state, ref.node, from, to, (line, _start, end) => {
          ranges.push(wrapIndentLine(`${end - line.from}ch`).range(line.from));
        });
        return false;
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const sourceWrapIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
