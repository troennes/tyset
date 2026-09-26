// Each GitHub alert drawn as one minium `.alert` box, in a layer behind its lines. Styling the
// lines themselves repeats the border and shadow on every line, and WebKit draws the rounded
// first and last lines' translucent borders brighter than the ones between them. The lines
// only add padding and the text colour (theme.ts).
import { syntaxTree } from "@codemirror/language";
import { type EditorView, layer, RectangleMarker } from "@codemirror/view";

import { ALERT_TITLE } from "../alerts";

function markers(view: EditorView): RectangleMarker[] {
  const { state } = view;
  // Layer coordinates start at the scroller's top left corner, scrolled with the content.
  const scroller = view.scrollDOM.getBoundingClientRect();
  const originLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
  const originTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
  // Lines span the content's width inside its padding.
  const content = view.contentDOM.getBoundingClientRect();
  const style = getComputedStyle(view.contentDOM);
  const left = (content.left - originLeft) / view.scaleX + parseFloat(style.paddingLeft);
  const width = content.width / view.scaleX - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const documentTop = (view.documentTop - originTop) / view.scaleY;

  const boxes: RectangleMarker[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Blockquote") return true;
        const kind = ALERT_TITLE.exec(state.doc.lineAt(node.from).text)?.[1].toLowerCase();
        if (kind && !seen.has(node.from)) {
          seen.add(node.from);
          const first = view.lineBlockAt(node.from);
          const last = view.lineBlockAt(node.to);
          const box = `cm-alert-box cm-alert-box-${kind}`;
          boxes.push(new RectangleMarker(box, left, documentTop + first.top, width, last.bottom - first.top));
        }
        return false;
      },
    });
  }
  return boxes;
}

export const alertBoxes = layer({
  above: false,
  class: "cm-alert-layer",
  markers,
  update: (update) =>
    update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state),
});
