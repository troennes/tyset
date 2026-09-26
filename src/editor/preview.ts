// Live preview: hide markdown syntax and draw widgets, except where the cursor
// is, so the raw markdown appears exactly where you edit it (like Typora).
// Only decorations change; the document text is never touched.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { ALERT_TITLE, type AlertKind } from "../alerts";
import type { EditorHost } from "./host";
import { destination } from "./links";
import {
  AlertLabelWidget,
  BulletWidget,
  CheckboxWidget,
  CodeLanguageWidget,
  ImageWidget,
} from "./widgets";

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const checked = Decoration.replace({ widget: new CheckboxWidget(true) });
const unchecked = Decoration.replace({ widget: new CheckboxWidget(false) });
const hrLine = Decoration.line({ class: "cm-hr" });
const blockEnd = Decoration.line({ class: "cm-block-end" });
const afterBlock = Decoration.line({ class: "cm-after-block" });
const inlineCode = Decoration.mark({ class: "cm-inline-code" });
const alertFirst = Decoration.line({ class: "cm-alert-first" });
const alertLast = Decoration.line({ class: "cm-alert-last" });
const listIndent = Decoration.mark({ class: "cm-list-indent" });

const INLINE_MARKS: Record<string, string> = {
  Emphasis: "EmphasisMark",
  StrongEmphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  InlineCode: "CodeMark",
};

/** Inline HTML we render; everything else stays as source text. */
const INLINE_HTML = /^<(kbd|sup|sub|mark)>$/i;

/**
 * Blocks drawn with a background or side bar (for HTML, the accordion summary): their space
 * goes above the next block instead.
 */
export const BOXED = new Set(["FencedCode", "CodeBlock", "Blockquote", "HorizontalRule", "HTMLBlock"]);
/** Blocks that keep their own spacing (the table grid) or render nothing. */
const UNSPACED = new Set(["Table", "CommentBlock", "LinkReference", "ProcessingInstructionBlock"]);

class Builder {
  readonly decorations: Range<Decoration>[] = [];

  constructor(
    readonly state: EditorState,
    readonly host: EditorHost,
    /** The visible range being built; line decorations are clipped to it. */
    readonly from: number,
    readonly to: number,
  ) {}

  /** The selection touches from..to, including its edges (the cursor right after `**bold**`). */
  touches(from: number, to: number): boolean {
    return this.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  }

  /** The selection is strictly inside from..to (for small widgets such as checkboxes). */
  inside(from: number, to: number): boolean {
    return this.state.selection.ranges.some((r) => r.to > from && r.from < to);
  }

  /** The selection is on any line of from..to. */
  onLines(from: number, to: number): boolean {
    const { doc } = this.state;
    return this.touches(doc.lineAt(from).from, doc.lineAt(to).to);
  }

  /** `pos` is in the visible range being built (so a line decoration there is added only once). */
  visible(pos: number): boolean {
    return pos >= this.from && pos <= this.to;
  }

  hide(from: number, to: number): void {
    if (to > from) this.decorations.push(hidden.range(from, to));
  }

  add(decoration: Decoration, from: number, to = from): void {
    this.decorations.push(decoration.range(from, to));
  }

  /** Add a line decoration to each line of from..to that is in the visible range. */
  lines(decoration: Decoration, from: number, to: number): void {
    const { doc } = this.state;
    const first = doc.lineAt(Math.max(from, this.from)).number;
    const last = doc.lineAt(Math.min(to, this.to)).number;
    for (let n = first; n <= last; n++) this.add(decoration, doc.line(n).from);
  }

  text(node: { from: number; to: number } | null): string {
    return node ? this.state.sliceDoc(node.from, node.to) : "";
  }

  /** Length of the space after `pos` (0 or 1), so "# " hides as a whole. */
  space(pos: number): number {
    return this.state.sliceDoc(pos, pos + 1) === " " ? 1 : 0;
  }

  /** Returns false to skip the node's children. */
  node(node: SyntaxNode): boolean {
    const { name } = node;
    if (name in INLINE_MARKS) {
      if (name === "InlineCode") this.add(inlineCode, node.from, node.to);
      if (!this.touches(node.from, node.to)) {
        for (const mark of node.getChildren(INLINE_MARKS[name])) this.hide(mark.from, mark.to);
      }
      return true;
    }
    if (/^ATXHeading/.test(name)) return this.heading(node);
    if (/^SetextHeading/.test(name)) {
      const underline = node.getChild("HeaderMark");
      if (underline && !this.onLines(node.from, node.to)) this.hide(underline.from, underline.to);
      return true;
    }
    switch (name) {
      case "Link":
        return this.link(node);
      case "Autolink":
        if (!this.touches(node.from, node.to)) {
          for (const mark of node.getChildren("LinkMark")) this.hide(mark.from, mark.to);
        }
        return false;
      case "Image":
        return this.image(node);
      case "BulletList":
      case "OrderedList":
        if (node.parent?.name !== "ListItem") this.listIndents(node);
        return true;
      case "ListMark":
        return this.listMark(node);
      case "TaskMarker":
        if (!this.inside(node.from, node.to)) {
          this.add(/x/i.test(this.text(node)) ? checked : unchecked, node.from, node.to);
        }
        return false;
      case "Blockquote":
        return this.blockquote(node);
      case "QuoteMark":
        if (!this.onLines(node.from, node.from)) this.hide(node.from, node.to + this.space(node.to));
        return false;
      case "HorizontalRule":
        if (!this.onLines(node.from, node.to)) {
          this.add(hrLine, this.state.doc.lineAt(node.from).from);
          this.hide(node.from, node.to);
        }
        return false;
      case "FencedCode":
        return this.fencedCode(node);
      case "Escape":
        if (!this.touches(node.from, node.to)) this.hide(node.from, node.from + 1);
        return false;
      case "HTMLTag":
        this.inlineHtml(node);
        return false;
    }
    return true;
  }

  /**
   * Space after each top-level block, like the margins in rendered markdown, whether or not
   * its syntax is showing.
   */
  blockSpacing(): void {
    const { doc } = this.state;
    const top = syntaxTree(this.state).topNode;
    for (let block = top.firstChild; block; block = block.nextSibling) {
      if (block.from > this.to) break;
      if (UNSPACED.has(block.name)) continue;
      if (!BOXED.has(block.name)) {
        const last = doc.lineAt(block.to).from;
        if (this.visible(last)) this.add(blockEnd, last);
        continue;
      }
      // Two boxed blocks in a row keep a blank line between them (blanklines.ts).
      const next = block.nextSibling;
      if (!next || BOXED.has(next.name)) continue;
      const first = doc.lineAt(next.from).from;
      if (this.visible(first)) this.add(afterBlock, first);
    }
  }

  private heading(node: SyntaxNode): boolean {
    if (this.onLines(node.from, node.to)) return true;
    for (const mark of node.getChildren("HeaderMark")) {
      if (mark.from === node.from) {
        this.hide(mark.from, mark.to + this.space(mark.to)); // "## "
      } else {
        // Optional closing marks: "## Title ##"
        const before = this.state.sliceDoc(mark.from - 1, mark.from) === " " ? 1 : 0;
        this.hide(mark.from - before, mark.to);
      }
    }
    return true;
  }

  private link(node: SyntaxNode): boolean {
    const marks = node.getChildren("LinkMark");
    // The parser reads any "[text]" as a shortcut reference link; without a
    // matching "[text]: url" definition it is plain text.
    const href = destination(this.state, node);
    if (marks.length < 2 || !href) return true;
    const [open, close] = marks;
    if (close.from > open.to) {
      const title = `${href} (Ctrl+click to open)`;
      this.add(Decoration.mark({ class: "cm-link-text", attributes: { title } }), open.to, close.from);
    }
    // Show only the link text: hide "[" and everything from "]" on.
    if (!this.touches(node.from, node.to)) {
      this.hide(open.from, open.to);
      this.hide(close.from, node.to);
    }
    return true;
  }

  private image(node: SyntaxNode): boolean {
    const url = this.text(node.getChild("URL")).replace(/^<|>$/g, "");
    const marks = node.getChildren("LinkMark");
    const alt = marks.length >= 2 ? this.state.sliceDoc(marks[0].to, marks[1].from) : "";
    if (!url) return true;
    const widget = new ImageWidget(this.host.imageUrl(url), alt);
    if (this.touches(node.from, node.to)) {
      // Editing the syntax: keep the image visible after it.
      this.add(Decoration.widget({ widget, side: 1 }), node.to);
    } else {
      this.add(Decoration.replace({ widget }), node.from, node.to);
    }
    return false;
  }

  /**
   * Widen the leading spaces of each line in a list, so nesting shows clearly in the
   * proportional font. Inside a code block only the list's own indentation is widened.
   */
  private listIndents(list: SyntaxNode): void {
    const { doc } = this.state;
    const tree = syntaxTree(this.state);
    const first = doc.lineAt(Math.max(list.from, this.from)).number;
    const last = doc.lineAt(Math.min(list.to, this.to)).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      let end = line.from + /^ */.exec(line.text)![0].length;
      if (end === line.from) continue;
      for (let at: SyntaxNode | null = tree.resolveInner(end, 1); at; at = at.parent) {
        if (at.name === "FencedCode" || at.name === "CodeBlock") {
          if (at.from < line.from) end = Math.min(end, line.from + (at.from - doc.lineAt(at.from).from));
          break;
        }
      }
      if (end > line.from) this.add(listIndent, line.from, end);
    }
  }

  private listMark(node: SyntaxNode): boolean {
    const item = node.parent;
    if (item?.getChild("Task")) {
      // The checkbox stands in for the bullet: hide "- ".
      const end = node.to + this.space(node.to);
      if (!this.inside(node.from, end)) this.hide(node.from, end);
    } else if (item?.parent?.name === "BulletList") {
      // The bullet takes "- " as a whole, one indent step wide, so nested items and
      // continuation lines line up with the text.
      const end = node.to + this.space(node.to);
      if (!this.inside(node.from, end)) this.add(bullet, node.from, end);
    }
    return false;
  }

  private blockquote(node: SyntaxNode): boolean {
    const { doc } = this.state;
    const firstLine = doc.lineAt(node.from);
    const alert = ALERT_TITLE.exec(firstLine.text);
    if (!alert) {
      this.lines(Decoration.line({ class: "cm-quote" }), node.from, node.to);
      return true;
    }
    const kind = alert[1].toLowerCase() as AlertKind;
    this.lines(Decoration.line({ class: `cm-alert cm-alert-${kind}` }), node.from, node.to);
    // Padding inside the top and bottom of the box (drawn by alertbox.ts).
    const lastLine = doc.lineAt(node.to);
    if (this.visible(firstLine.from)) this.add(alertFirst, firstLine.from);
    if (this.visible(lastLine.from)) this.add(alertLast, lastLine.from);
    if (!this.onLines(firstLine.from, firstLine.to)) {
      const marker = firstLine.text.indexOf("[");
      this.add(
        Decoration.replace({ widget: new AlertLabelWidget(kind) }),
        firstLine.from + marker,
        firstLine.from + firstLine.text.trimEnd().length,
      );
    }
    return true;
  }

  private fencedCode(node: SyntaxNode): boolean {
    if (this.touches(node.from, node.to)) return false;
    const { doc } = this.state;
    const open = doc.lineAt(node.from);
    const close = doc.lineAt(node.to);
    const language = this.text(node.getChild("CodeInfo")).trim();
    // The fence lines stay as padding above and below the code.
    this.hide(open.from, open.to);
    if (language) this.add(Decoration.widget({ widget: new CodeLanguageWidget(language), side: 1 }), open.to);
    const closeMarks = node.getChildren("CodeMark");
    if (close.number > open.number && closeMarks.length > 1) this.hide(close.from, close.to);
    return false;
  }

  /** `<kbd>x</kbd>` and friends: hide the tags and style the text between them. */
  private inlineHtml(open: SyntaxNode): void {
    const tag = INLINE_HTML.exec(this.text(open))?.[1].toLowerCase();
    if (!tag) return;
    for (let next = open.nextSibling; next; next = next.nextSibling) {
      if (next.name !== "HTMLTag") continue;
      if (this.text(next).toLowerCase() !== `</${tag}>`) continue;
      if (this.touches(open.from, next.to)) return;
      this.hide(open.from, open.to);
      this.hide(next.from, next.to);
      if (next.from > open.to) this.add(Decoration.mark({ class: `cm-html-${tag}` }), open.to, next.from);
      return;
    }
  }
}

function build(view: EditorView, host: EditorHost): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const builder = new Builder(view.state, host, from, to);
    builder.blockSpacing();
    syntaxTree(view.state).iterate({ from, to, enter: (ref) => builder.node(ref.node) });
    decorations.push(...builder.decorations);
  }
  return Decoration.set(decorations, true);
}

export function livePreview(host: EditorHost) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, host);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          this.decorations = build(update.view, host);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
