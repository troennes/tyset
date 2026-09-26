// Live preview: hide markdown syntax and draw widgets, except where the cursor
// is, so the raw markdown appears exactly where you edit it (like Typora).
// Only decorations change; the document text is never touched.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import type { EditorHost } from "./host";
import { destination } from "./links";
import {
  type AlertKind,
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
const headingLine = Decoration.line({ class: "cm-heading" });
const inlineCode = Decoration.mark({ class: "cm-inline-code" });

const INLINE_MARKS: Record<string, string> = {
  Emphasis: "EmphasisMark",
  StrongEmphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  InlineCode: "CodeMark",
};

const ALERT = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
/** Inline HTML we render; everything else stays as source text. */
const INLINE_HTML = /^<(kbd|sup|sub|mark)>$/i;

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
      this.headingSpace(node);
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

  /** Space below a heading's last line, whether or not its syntax is showing. */
  private headingSpace(node: SyntaxNode): void {
    if (node.to >= this.from && node.to <= this.to) this.add(headingLine, this.state.doc.lineAt(node.to).from);
  }

  private heading(node: SyntaxNode): boolean {
    this.headingSpace(node);
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

  private listMark(node: SyntaxNode): boolean {
    const item = node.parent;
    if (item?.getChild("Task")) {
      // The checkbox stands in for the bullet: hide "- ".
      const end = node.to + this.space(node.to);
      if (!this.inside(node.from, end)) this.hide(node.from, end);
    } else if (item?.parent?.name === "BulletList" && !this.inside(node.from, node.to)) {
      this.add(bullet, node.from, node.to);
    }
    return false;
  }

  private blockquote(node: SyntaxNode): boolean {
    const { doc } = this.state;
    const firstLine = doc.lineAt(node.from);
    const alert = ALERT.exec(firstLine.text);
    if (!alert) {
      this.lines(Decoration.line({ class: "cm-quote" }), node.from, node.to);
      return true;
    }
    const kind = alert[1].toLowerCase() as AlertKind;
    this.lines(Decoration.line({ class: `cm-alert cm-alert-${kind}` }), node.from, node.to);
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
