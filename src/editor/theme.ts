// Editor styling. It goes through CodeMirror's theme API because CodeMirror's
// injected CSS is unlayered and beats anything in minium's cascade layers.
// Colours come from minium tokens; code colours from minium's Prism palette.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const base = EditorView.theme({
  "&": { flex: "1", minWidth: "0", backgroundColor: "transparent", color: "var(--color-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { lineHeight: "var(--line-height)" },
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
  ".cm-searchMatch": {
    backgroundColor: "var(--color-warning-fill-hover)",
    outline: "1px solid var(--color-warning-border-strong)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--color-warning-fill-active)" },
  ".cm-panels": { backgroundColor: "var(--color-surface)", color: "var(--color-text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "var(--border-width) solid var(--color-border-weak)" },
  ".cm-codeblock": { fontFamily: "var(--font-mono)", backgroundColor: "var(--color-surface-sunken)" },
});

/** Formatted view: proportional type, sized headings. Live preview builds on this (milestone 3). */
const richTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font)", fontSize: "var(--size-body)" },
  ".cm-line.cm-codeblock": { fontSize: "var(--font-mono-size)", paddingInline: "var(--space-xs)" },
});

/** Source mode: everything monospace, headings not resized. */
const sourceTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "var(--size-body)" },
  ".cm-line.cm-codeblock": { backgroundColor: "transparent" },
});

const markdownColours = [
  { tag: t.strong, fontWeight: "var(--font-weight-bold)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--color-primary-text)" },
  { tag: t.quote, color: "var(--color-text-muted)" },
  { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: "var(--color-text-muted)" },
  { tag: t.atom, color: "var(--color-accent-text)" },
  { tag: t.comment, color: "var(--syntax-comment)" },
  // Code inside fences, as coloured by the fence's language.
  { tag: t.keyword, color: "var(--syntax-keyword)" },
  { tag: [t.string, t.regexp], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool], color: "var(--syntax-number)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syntax-function)" },
  { tag: [t.typeName, t.className, t.constant(t.name), t.propertyName], color: "var(--syntax-constant)" },
  { tag: [t.tagName, t.attributeName], color: "var(--syntax-tag)" },
  { tag: t.operator, color: "var(--syntax-operator)" },
  { tag: t.punctuation, color: "var(--syntax-punctuation)" },
];

const richHighlight = HighlightStyle.define([
  ...markdownColours,
  { tag: t.heading1, fontSize: "var(--size-h1)", fontWeight: "var(--font-weight-bold)", lineHeight: "1.2" },
  { tag: t.heading2, fontSize: "var(--size-h2)", fontWeight: "var(--font-weight-bold)", lineHeight: "1.25" },
  { tag: t.heading3, fontSize: "var(--size-h3)", fontWeight: "var(--font-weight-bold)" },
  { tag: t.heading4, fontSize: "var(--size-h4)", fontWeight: "var(--font-weight-bold)" },
  { tag: [t.heading5, t.heading6], fontWeight: "var(--font-weight-bold)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-mono-size)",
    backgroundColor: "var(--color-fill-hover)",
    borderRadius: "var(--border-radius-s)",
  },
]);

const sourceHighlight = HighlightStyle.define([
  ...markdownColours,
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "var(--font-weight-bold)" },
]);

export const baseTheme: Extension = base;
export const richMode: Extension = [richTheme, syntaxHighlighting(richHighlight)];
export const sourceMode: Extension = [sourceTheme, syntaxHighlighting(sourceHighlight)];
