// Headings for the outline, and jumping to a position.
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface Heading {
  level: number;
  text: string;
  /** Start of the heading line. */
  from: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** All headings, by line scan (the syntax tree may not cover the whole document yet). */
export function headings(state: EditorState): Heading[] {
  const { doc } = state;
  const found: Heading[] = [];
  let fence: string | null = null;
  let previous: { text: string; from: number } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const fenceMatch = FENCE.exec(line.text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      previous = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      previous = null;
      continue;
    }
    const atx = ATX.exec(line.text);
    const setext = SETEXT.exec(line.text);
    if (atx) {
      found.push({ level: atx[1].length, text: clean(atx[2] ?? ""), from: line.from });
      previous = null;
    } else if (setext && previous) {
      // "Title" followed by === or --- (a paragraph's underline).
      found.push({ level: setext[1][0] === "=" ? 1 : 2, text: clean(previous.text), from: previous.from });
      previous = null;
    } else {
      const isParagraph = line.text.trim() !== "" && !/^\s*([>*+-]|\d+[.)]|<|\|)/.test(line.text);
      previous = isParagraph ? { text: line.text, from: line.from } : null;
    }
  }
  return found;
}

/** Heading text without inline markdown, for display. */
function clean(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
    .trim();
}

/** Move the cursor to `pos`, expanding collapsed accordions around it, and scroll it to the top. */
export function revealPosition(view: EditorView, pos: number): void {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(pos, pos, (from, to) => {
    if (from < pos && to >= pos) effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }));
  view.dispatch({ selection: { anchor: pos }, effects });
  view.focus();
}
