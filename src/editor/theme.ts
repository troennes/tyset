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

const alertColours = {
  note: "info",
  tip: "success",
  important: "accent",
  warning: "warning",
  caution: "danger",
} as const;

/** Formatted view with live preview: proportional type, sized headings, widgets. */
const richStyles = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font)", fontSize: "var(--size-body)" },
  ".cm-line.cm-codeblock": { fontSize: "var(--font-mono-size)", paddingInline: "var(--space-xs)" },
  ".cm-code-language": {
    float: "right",
    fontFamily: "var(--font)",
    fontSize: "var(--size-tiny)",
    color: "var(--color-text-muted)",
  },

  ".cm-link-text": { textDecoration: "underline", textUnderlineOffset: "var(--text-underline-offset)" },
  ".cm-bullet": { display: "inline-block", width: "1ch", color: "var(--color-text-muted)" },
  ".cm-task": { margin: "0 0.4em 0 0", verticalAlign: "-0.1em", cursor: "pointer" },

  ".cm-line.cm-quote": {
    borderInlineStart: "3px solid var(--color-border-strong)",
    paddingInlineStart: "var(--space-s)",
    color: "var(--color-text-muted)",
  },
  ".cm-line.cm-alert": { paddingInlineStart: "var(--space-s)", borderInlineStart: "3px solid" },
  ...Object.fromEntries(
    Object.entries(alertColours).flatMap(([kind, tone]) => [
      [`.cm-line.cm-alert-${kind}`, { borderColor: `var(--color-${tone})`, backgroundColor: `var(--color-${tone}-fill)` }],
      [`.cm-alert-label-${kind}`, { color: `var(--color-${tone}-text)` }],
    ]),
  ),
  ".cm-alert-label": { fontWeight: "var(--font-weight-bold)" },

  ".cm-line.cm-hr": {
    backgroundImage: "linear-gradient(var(--color-border-strong), var(--color-border-strong))",
    backgroundSize: "100% 1px",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },

  ".cm-image": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "60vh",
    margin: "var(--space-2xs) 0",
    borderRadius: "var(--border-radius-s)",
  },
  ".cm-image-broken": {
    minWidth: "8rem",
    minHeight: "2rem",
    outline: "1px dashed var(--color-border-strong)",
  },

  ".cm-html-kbd": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--size-small)",
    padding: "0 0.3em",
    border: "var(--border-width) solid var(--color-border-strong)",
    borderBottomWidth: "2px",
    borderRadius: "var(--border-radius-s)",
  },
  ".cm-html-sup": { verticalAlign: "super", fontSize: "var(--size-small)" },
  ".cm-html-sub": { verticalAlign: "sub", fontSize: "var(--size-small)" },
  ".cm-html-mark": { backgroundColor: "var(--color-warning-fill-hover)" },

  // Table grid (table.ts). The toolbar shows while a cell has focus.
  // Padding, not margin: CodeMirror measures block widgets without their margins.
  ".cm-table": { position: "relative", padding: "2rem 0 var(--space-xs)", overflowX: "auto" },
  ".cm-table table": { borderCollapse: "collapse", margin: "0", minWidth: "50%" },
  ".cm-table th, .cm-table td": {
    border: "var(--border-width) solid var(--color-border-strong)",
    padding: "var(--space-3xs) var(--space-2xs)",
    minWidth: "4ch",
    whiteSpace: "pre-wrap",
    verticalAlign: "top",
    outline: "none",
  },
  ".cm-table th": { backgroundColor: "var(--color-fill)", fontWeight: "var(--font-weight-bold)", textAlign: "start" },
  ".cm-table th:focus, .cm-table td:focus": { boxShadow: "inset 0 0 0 2px var(--color-primary-focus)" },
  ".cm-table code": { fontFamily: "var(--font-mono)", fontSize: "var(--font-mono-size)" },
  ".cm-table-toolbar": {
    position: "absolute",
    top: "0",
    left: "0",
    display: "flex",
    flexWrap: "wrap",
    gap: "2px",
    visibility: "hidden",
    fontFamily: "var(--font)",
    fontSize: "var(--size-tiny)",
  },
  ".cm-table.cm-table-active .cm-table-toolbar": { visibility: "visible" },
  // Plain toolbar buttons: undo minium's button styling (theme CSS is unlayered, so it wins).
  ".cm-table-toolbar button": {
    all: "unset",
    cursor: "pointer",
    padding: "0.15em 0.5em",
    borderRadius: "var(--border-radius-s)",
    color: "var(--color-text-muted)",
    backgroundColor: "var(--color-fill)",
  },
  ".cm-table-toolbar button:hover": { color: "var(--color-text)", backgroundColor: "var(--color-fill-active)" },
  ".cm-table-toolbar [data-action=delete-table]": { marginInlineStart: "auto", color: "var(--color-danger-text)" },

  // Accordions: the tag lines collapse to nothing; the summary is a header row.
  ".cm-line.cm-accordion-tag": { fontSize: "0", lineHeight: "0", height: "0", overflow: "hidden" },
  ".cm-line.cm-accordion-summary": {
    fontWeight: "var(--font-weight-bold)",
    backgroundColor: "var(--color-fill)",
    borderRadius: "var(--border-radius-s)",
    paddingInline: "var(--space-3xs)",
  },
  // role="button" picks up minium's button styles; reset them (theme CSS is unlayered, so it wins).
  ".cm-accordion-toggle": {
    all: "unset",
    display: "inline-block",
    width: "1.25em",
    textAlign: "center",
    cursor: "pointer",
    color: "var(--color-text-muted)",
    transition: "transform 0.15s",
    userSelect: "none",
  },
  ".cm-accordion-toggle[aria-expanded=true]": { transform: "rotate(90deg)" },
  ".cm-accordion-folded": { marginInlineStart: "0.5em", color: "var(--color-text-muted)", cursor: "pointer" },
  // One indent guide per nesting level.
  ".cm-line.cm-accordion-body": {
    paddingInlineStart: "calc(var(--accordion-depth) * 1rem)",
    backgroundImage:
      "repeating-linear-gradient(to right, var(--color-border-weak) 0 2px, transparent 2px 1rem)",
    backgroundSize: "calc(var(--accordion-depth) * 1rem) 100%",
    backgroundRepeat: "no-repeat",
  },
});

/** Source mode: everything monospace, headings not resized. */
const sourceStyles = EditorView.theme({
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
export const richTheme: Extension = [richStyles, syntaxHighlighting(richHighlight)];
export const sourceTheme: Extension = [sourceStyles, syntaxHighlighting(sourceHighlight)];
