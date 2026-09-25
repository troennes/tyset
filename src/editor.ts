// The CodeMirror instance. Milestone 1: plain markdown source editing.
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

export function createEditor(parent: HTMLElement, onChange: () => void): EditorView {
  return new EditorView({ parent, state: EditorState.create({ extensions: extensions(onChange) }) });
}

/** Replace the whole document with a fresh state (new file: no undo history carried over). */
export function loadDocument(view: EditorView, text: string, onChange: () => void): void {
  view.setState(EditorState.create({ doc: text, extensions: extensions(onChange) }));
}

/** Swap in text that changed on disk, keeping undo history and the cursor where possible. */
export function replaceDocument(view: EditorView, text: string): void {
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    annotations: externalEdit.of(true),
  });
}

/** Marks transactions that mirror disk contents, so they don't trigger a save. */
const externalEdit = Annotation.define<boolean>();

// Styled through CodeMirror's theme API: its injected CSS is unlayered, so it
// beats anything in minium's cascade layers. Colours come from minium tokens.
const theme = EditorView.theme({
  "&": { flex: "1", minWidth: "0", backgroundColor: "transparent", color: "var(--color-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font)",
    fontSize: "var(--size-body)",
    lineHeight: "var(--line-height)",
  },
  // A centred, readable column, like Typora.
  ".cm-content": {
    maxWidth: "var(--content-width)",
    width: "100%",
    margin: "0 auto",
    padding: "var(--space-l) var(--space-m)",
    caretColor: "var(--color-text)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--color-text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--color-primary-fill-active)",
  },
});

function extensions(onChange: () => void): Extension[] {
  return [
    theme,
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off" }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((t) => t.annotation(externalEdit))) onChange();
    }),
  ];
}
