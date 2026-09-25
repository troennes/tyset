// Formatting commands. They edit markdown text directly and use the syntax
// tree to recognise existing formatting, so pressing a shortcut twice undoes it.
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

interface InlineStyle {
  /** Syntax node for the styled span, e.g. StrongEmphasis. */
  node: string;
  /** Syntax node for its delimiters, e.g. EmphasisMark. */
  markNode: string;
  /** Delimiter to insert. */
  mark: string;
}

export const strong: InlineStyle = { node: "StrongEmphasis", markNode: "EmphasisMark", mark: "**" };
export const emphasis: InlineStyle = { node: "Emphasis", markNode: "EmphasisMark", mark: "*" };
export const inlineCode: InlineStyle = { node: "InlineCode", markNode: "CodeMark", mark: "`" };

/** Formatting is its own undo step, never merged with typing before or after it. */
const formatting = { scrollIntoView: true, userEvent: "input.format", annotations: isolateHistory.of("full") };

/** Wrap the selection (or the word at the cursor) in `style`, or unwrap it if already styled. */
export const toggleInline = (style: InlineStyle): StateCommand => ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const styled = enclosing(state, range.from, range.to, style.node);
    if (styled) {
      const open = styled.firstChild;
      const close = styled.lastChild;
      if (open?.name === style.markNode && close?.name === style.markNode && open !== close) {
        const changes = state.changes([
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ]);
        return { changes, range: range.map(changes) };
      }
    }

    let { from, to } = range;
    if (range.empty) {
      const word = state.wordAt(range.head);
      if (!word) {
        // Nothing to wrap: insert empty delimiters with the cursor between them.
        return {
          changes: { from, insert: style.mark + style.mark },
          range: EditorSelection.cursor(from + style.mark.length),
        };
      }
      ({ from, to } = word);
    } else {
      // `** bold **` is not bold in markdown, so keep surrounding spaces outside.
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
    }
    const n = style.mark.length;
    const changes = [
      { from, insert: style.mark },
      { from: to, insert: style.mark },
    ];
    const newRange = range.empty
      ? EditorSelection.cursor(range.head + n)
      : EditorSelection.range(from + n, to + n);
    return { changes, range: newRange };
  });
  dispatch(state.update(tr, formatting));
  return true;
};

/** The innermost `name` node that covers from..to, if any. */
function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(from, side); node; node = node.parent) {
      if (node.name === name && node.from <= from && node.to >= to) return node;
    }
  }
  return null;
}

const HEADING_PREFIX = /^(#{1,6})(?:[ \t]+|$)/;

/**
 * Make the selected lines headings of `level` (0 = paragraph).
 * If every line already has that level, turn them back into paragraphs, as Typora does.
 */
export const setHeading = (level: number): StateCommand => ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const levelOf = (text: string) => HEADING_PREFIX.exec(text)?.[1].length ?? 0;
  const target = level > 0 && lines.every((l) => levelOf(l.text) === level) ? 0 : level;
  const changes: ChangeSpec[] = lines.map((line) => {
    const current = HEADING_PREFIX.exec(line.text)?.[0] ?? "";
    return { from: line.from, to: line.from + current.length, insert: target ? "#".repeat(target) + " " : "" };
  });
  dispatch(state.update({ changes, ...formatting }));
  return true;
};

function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines;
}

const URL_LIKE = /^(https?:\/\/|mailto:|www\.)\S+$/i;

/** Ctrl+K: turn the selection into a link and put the cursor where typing is needed next. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (URL_LIKE.test(text)) {
      // Selected a URL: `[|](url)`, type the link text.
      return {
        changes: { from: range.from, to: range.to, insert: `[](${text})` },
        range: EditorSelection.cursor(range.from + 1),
      };
    }
    // Selected text (or nothing): `[text](|)`, type the URL.
    const insert = `[${text}]()`;
    const cursor = text ? range.from + insert.length - 1 : range.from + 1;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
  dispatch(state.update(tr, formatting));
  return true;
};

const ACCORDION_TITLE = "Title";

/**
 * Insert an accordion as the `<details>` HTML that GitHub renders, wrapping the
 * selected lines as its body. The title is selected, ready to type over.
 */
export const insertAccordion: StateCommand = ({ state, dispatch }) => {
  const br = state.lineBreak;
  const range = state.selection.main;
  const firstLine = state.doc.lineAt(range.from);
  const lastLine = state.doc.lineAt(range.to);

  let from: number;
  let to: number;
  let body: string;
  let before = "";
  if (!range.empty) {
    // Wrap whole lines so the body stays valid markdown.
    from = firstLine.from;
    to = lastLine.to;
    body = state.sliceDoc(from, to);
  } else if (firstLine.text.trim() === "") {
    from = to = firstLine.from;
    body = "";
  } else {
    // Cursor in a paragraph: add the accordion after it, as a new block.
    from = to = firstLine.to;
    body = "";
    before = br + br;
  }

  const open = `<details>${br}<summary>`;
  // GitHub needs blank lines around the body to render the markdown inside it.
  const insert = `${before}${open}${ACCORDION_TITLE}</summary>${br}${br}${body}${br}${br}</details>`;
  const titleFrom = from + before.length + open.length;
  dispatch(
    state.update({
      changes: { from, to, insert },
      selection: EditorSelection.range(titleFrom, titleFrom + ACCORDION_TITLE.length),
      ...formatting,
    }),
  );
  return true;
};
