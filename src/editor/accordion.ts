// Accordions: GitHub's `<details><summary>` HTML, drawn as a collapsible
// section. Collapsing uses CodeMirror folding, which is view state only and
// never changes the file.
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { AccordionToggleWidget } from "./widgets";

export interface Accordion {
  /** Line numbers (1-based). */
  open: number;
  summary: number | null;
  close: number | null;
  /** Has the `open` attribute: expanded when the file is opened. */
  startsOpen: boolean;
  /** Nesting depth, 0 for top level. */
  depth: number;
}

const OPEN = /^\s*<details(\s+open(?:=(?:"[^"]*"|'[^']*'|\S+))?)?\s*>\s*(<summary>.*<\/summary>)?\s*$/i;
const SUMMARY = /^\s*<summary>.*<\/summary>\s*$/i;
const CLOSE = /^\s*<\/details>\s*$/i;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Find accordions by line, skipping fenced code. Cheap enough to redo on every edit. */
export function scan(doc: Text): Accordion[] {
  const found: Accordion[] = [];
  const stack: Accordion[] = [];
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
    const open = OPEN.exec(text);
    if (open) {
      const accordion: Accordion = {
        open: n,
        summary: open[2] ? n : null,
        close: null,
        startsOpen: !!open[1],
        depth: stack.length,
      };
      stack.push(accordion);
      found.push(accordion);
    } else if (SUMMARY.test(text) && stack.length) {
      const top = stack[stack.length - 1];
      if (top.summary === null && n === top.open + 1) top.summary = n;
    } else if (CLOSE.test(text) && stack.length) {
      stack.pop()!.close = n;
    }
  }
  return found;
}

export const accordions = StateField.define<Accordion[]>({
  create: (state) => scan(state.doc),
  update: (value, tr) => (tr.docChanged ? scan(tr.state.doc) : value),
});

/** The foldable body: from the end of the summary line to the end of the last body line. */
function bodyRange(doc: Text, a: Accordion): { from: number; to: number } | null {
  if (a.summary === null) return null;
  const from = doc.line(a.summary).to;
  const to = a.close !== null ? doc.line(a.close - 1).to : doc.length;
  return to > from ? { from, to } : null;
}

function isFolded(state: EditorState, range: { from: number; to: number }): boolean {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) folded = true;
  });
  return folded;
}

function toggle(view: EditorView, pos: number): void {
  const { state } = view;
  const line = state.doc.lineAt(pos).number;
  const accordion = state.field(accordions).find((a) => a.summary === line);
  const range = accordion && bodyRange(state.doc, accordion);
  if (!range) return;
  view.dispatch({ effects: (isFolded(state, range) ? unfoldEffect : foldEffect).of(range) });
}

/** Effects that collapse every accordion without the `open` attribute (used when a file is opened). */
export function initialFolds(state: EditorState): StateEffect<unknown>[] {
  return state
    .field(accordions)
    .filter((a) => !a.startsOpen)
    .map((a) => bodyRange(state.doc, a))
    .filter((r) => r !== null)
    .map((r) => foldEffect.of(r));
}

/** Effects that expand everything (used when switching to source mode). */
export function unfoldAll(state: EditorState): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  return effects;
}

const tagLine = Decoration.line({ class: "cm-accordion-tag" });
const summaryLine = Decoration.line({ class: "cm-accordion-summary" });
const hidden = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const decorations: Range<Decoration>[] = [];
  const ranges = view.visibleRanges;
  const visible = (n: number) => {
    const line = doc.line(n);
    return ranges.some((r) => line.to >= r.from && line.from <= r.to);
  };
  const lineTouched = (n: number) => {
    const line = doc.line(n);
    return state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
  };
  // Strictly inside, so typing at the title's edges doesn't reveal the tags.
  const inside = (from: number, to: number) => state.selection.ranges.some((r) => r.to > from && r.from < to);

  /** Deepest accordion body each line belongs to, for the indent guides. */
  const depth = new Map<number, number>();

  for (const a of state.field(accordions)) {
    if (a.summary === null) continue; // not an accordion we can draw; leave as HTML
    const body = bodyRange(doc, a);

    if (a.open !== a.summary && visible(a.open) && !lineTouched(a.open)) {
      decorations.push(tagLine.range(doc.line(a.open).from));
      decorations.push(hidden.range(doc.line(a.open).from, doc.line(a.open).to));
    }

    if (visible(a.summary)) {
      const line = doc.line(a.summary);
      decorations.push(summaryLine.range(line.from));
      const folded = body ? isFolded(state, body) : true;
      decorations.push(
        Decoration.widget({ widget: new AccordionToggleWidget(folded, toggle), side: -1 }).range(line.from),
      );
      // Hide `<details>` (if on this line), `<summary>` and `</summary>`, leaving the editable title.
      const openTag = line.text.indexOf("<summary>");
      const closeTag = line.text.lastIndexOf("</summary>");
      const titleFrom = line.from + openTag + "<summary>".length;
      const titleTo = line.from + closeTag;
      if (!inside(line.from, titleFrom)) decorations.push(hidden.range(line.from, titleFrom));
      if (!inside(titleTo, line.to)) decorations.push(hidden.range(titleTo, line.to));
    }

    if (a.close !== null && visible(a.close) && !lineTouched(a.close)) {
      decorations.push(tagLine.range(doc.line(a.close).from));
      decorations.push(hidden.range(doc.line(a.close).from, doc.line(a.close).to));
    }

    const last = a.close !== null ? a.close - 1 : doc.lines;
    for (let n = a.summary + 1; n <= last; n++) {
      depth.set(n, Math.max(depth.get(n) ?? 0, a.depth + 1));
    }
  }

  for (const [n, d] of depth) {
    if (!visible(n)) continue;
    const line = Decoration.line({ class: "cm-accordion-body", attributes: { style: `--accordion-depth: ${d}` } });
    decorations.push(line.range(doc.line(n).from));
  }
  return Decoration.set(decorations, true);
}

const accordionView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      const foldsChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
      if (update.docChanged || update.selectionSet || update.viewportChanged || foldsChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Always present (folding and the scan work in both modes). */
export const accordionState = [
  accordions,
  codeFolding({
    placeholderDOM(_view, onclick) {
      const el = document.createElement("span");
      el.className = "cm-accordion-folded";
      el.textContent = "…";
      el.title = "Expand";
      el.addEventListener("click", onclick);
      return el;
    },
  }),
];

/** Live preview only. */
export const accordionPreview = accordionView;
