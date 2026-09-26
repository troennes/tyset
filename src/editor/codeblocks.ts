// Marks the lines of fenced and indented code blocks so the theme can give
// them a monospace font and background. The first and last line get extra
// classes so the block can have rounded corners.
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const codeLines = new Map<string, Decoration>();
function codeLine(first: boolean, last: boolean): Decoration {
  const cls = ["cm-codeblock", first && "cm-codeblock-first", last && "cm-codeblock-last"].filter(Boolean).join(" ");
  let deco = codeLines.get(cls);
  if (!deco) codeLines.set(cls, (deco = Decoration.line({ class: cls })));
  return deco;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const start = doc.lineAt(node.from).number;
        const end = doc.lineAt(node.to).number;
        const first = doc.lineAt(Math.max(node.from, from)).number;
        const last = doc.lineAt(Math.min(node.to, to)).number;
        for (let n = first; n <= last; n++) {
          builder.add(doc.line(n).from, doc.line(n).from, codeLine(n === start, n === end));
        }
        return false; // no nested code blocks
      },
    });
  }
  return builder.finish();
}

export const codeBlocks = ViewPlugin.fromClass(
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
