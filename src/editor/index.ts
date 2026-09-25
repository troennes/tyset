// The CodeMirror editor: markdown source with formatting, find/replace and source mode.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Annotation, Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";

import { codeBlocks } from "./codeblocks";
import {
  emphasis,
  inlineCode,
  insertAccordion,
  insertLink,
  setHeading,
  strong,
  toggleCodeBlock,
  toggleInline,
} from "./commands";
import { findReplace } from "./search";
import { baseTheme, richMode, sourceMode } from "./theme";

export { openFind } from "./search";

/** Marks transactions that mirror disk contents, so they don't trigger a save. */
const externalEdit = Annotation.define<boolean>();
const mode = new Compartment();
let inSourceMode = false;

export function createEditor(parent: HTMLElement, onChange: () => void): EditorView {
  return new EditorView({ parent, state: newState("", onChange) });
}

/** Replace the whole document with a fresh state (new file: no undo history carried over). */
export function loadDocument(view: EditorView, text: string, onChange: () => void): void {
  view.setState(newState(text, onChange));
}

/** Swap in text that changed on disk, keeping undo history and the cursor where possible. */
export function replaceDocument(view: EditorView, text: string, onChange: () => void): void {
  if (lineBreakOf(text) !== view.state.lineBreak) {
    loadDocument(view, text, onChange); // line endings changed: needs a new state
    return;
  }
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    annotations: externalEdit.of(true),
  });
}

export function isSourceMode(): boolean {
  return inSourceMode;
}

export function setSourceMode(view: EditorView, on: boolean): void {
  inSourceMode = on;
  view.dispatch({ effects: mode.reconfigure(on ? sourceMode : richMode) });
}

function newState(text: string, onChange: () => void): EditorState {
  return EditorState.create({ doc: text, extensions: extensions(lineBreakOf(text), onChange) });
}

/** Keep the file's own line endings, so saving a Windows file doesn't rewrite every line. */
function lineBreakOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

const formattingKeymap = keymap.of([
  { key: "Mod-b", run: toggleInline(strong) },
  { key: "Mod-i", run: toggleInline(emphasis) },
  // Code: Ctrl+' / Ctrl+Shift+'. On Norwegian keyboards ' is the key left of Enter (Shift+' is *),
  // since backtick is a dead key there. Ctrl+` also works on US layouts.
  { key: "Mod-'", run: toggleInline(inlineCode) },
  { key: "Mod-`", run: toggleInline(inlineCode) },
  { key: "Mod-*", run: toggleCodeBlock },
  { key: "Mod-Shift-'", run: toggleCodeBlock },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Shift-d", run: insertAccordion },
  ...[0, 1, 2, 3, 4, 5, 6].map((level) => ({ key: `Mod-${level}`, run: setHeading(level) })),
]);

function extensions(lineBreak: string, onChange: () => void): Extension[] {
  return [
    EditorState.lineSeparator.of(lineBreak),
    // Paste is always plain text; convert its line endings to the document's.
    EditorView.clipboardInputFilter.of((text, state) => text.replace(/\r\n?|\n/g, state.lineBreak)),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    // GFM (tables, task lists, strikethrough, autolinks); code fences highlighted by language.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    codeBlocks,
    baseTheme,
    mode.of(inSourceMode ? sourceMode : richMode),
    findReplace,
    // Above the default keymap, which binds Mod-i to "select parent syntax".
    Prec.high(formattingKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off" }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((t) => t.annotation(externalEdit))) onChange();
    }),
  ];
}
