// Ctrl+click opens links; pasting an image stores it beside the document.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import type { EditorHost } from "./host";

/** The link destination at `pos`: inline links, <autolinks>, bare URLs and [reference][links]. */
export function linkAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "URL" && node.parent?.name !== "Link" && node.parent?.name !== "Image") {
        return autolinkHref(state.sliceDoc(node.from, node.to)); // bare URL or <autolink>
      }
      if (node.name === "Link") return destination(state, node);
    }
  }
  return null;
}

/** Where an autolink's text points: a bare email address gets "mailto:". */
export function autolinkHref(text: string): string {
  return /^[^\s@/:]+@[^\s@/]+$/.test(text) ? `mailto:${text}` : text;
}

/** Tooltip on rendered links. */
export const linkTitle = (href: string) => `${href} (Ctrl+click to open)`;

/** Where a Link node points, or null for a "[reference]" that nothing defines. */
export function destination(state: EditorState, link: SyntaxNode): string | null {
  const url = link.getChild("URL");
  if (url) return state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "");
  // Reference link: [text][label] or [label]. Look up `[label]: url`.
  const labelNode = link.getChild("LinkLabel");
  const marks = link.getChildren("LinkMark");
  const label = labelNode
    ? state.sliceDoc(labelNode.from + 1, labelNode.to - 1)
    : marks.length >= 2
      ? state.sliceDoc(marks[0].to, marks[1].from)
      : "";
  if (!label) return null;
  const escaped = label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(`^ {0,3}\\[${escaped}\\]:\\s*<?([^\\s>]+)`, "im").exec(state.doc.toString());
  return definition?.[1] ?? null;
}

/**
 * Puts `cm-ctrl-held` on the editor while Ctrl (Cmd) is down, so links show the pointer
 * only when a click would open them.
 */
const ctrlHeld = ViewPlugin.define((view) => {
  const set = (held: boolean) => view.dom.classList.toggle("cm-ctrl-held", held);
  const sync = (e: KeyboardEvent | MouseEvent) => set(e.ctrlKey || e.metaKey);
  // WebKitGTK still reports ctrlKey on the Control key's own keyup.
  const keyup = (e: KeyboardEvent) => (e.key === "Control" || e.key === "Meta" ? set(false) : sync(e));
  const release = () => set(false);
  window.addEventListener("keydown", sync, true);
  window.addEventListener("keyup", keyup, true);
  window.addEventListener("mousemove", sync, true);
  window.addEventListener("blur", release);
  return {
    destroy() {
      window.removeEventListener("keydown", sync, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("mousemove", sync, true);
      window.removeEventListener("blur", release);
    },
  };
});

export function interactions(host: EditorHost): Extension {
  return [ctrlHeld, handlers(host)];
}

function handlers(host: EditorHost) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const href = pos === null ? null : linkAt(view.state, pos);
      if (!href) return false;
      event.preventDefault();
      host.openLink(href);
      return true;
    },

    // Plain text always wins. Without text, look for an image (read natively,
    // since WebKitGTK doesn't expose clipboard images to the page).
    paste(event, view) {
      if (event.clipboardData?.getData("text/plain")) return false;
      event.preventDefault();
      void host.pasteImage().then((link) => {
        if (link) insertImage(view, link);
      });
      return true;
    },
  });
}

/** Insert `![](link)` at `pos` (or the cursor). */
export function insertImage(view: EditorView, link: string, pos?: number): void {
  const at = pos ?? view.state.selection.main.head;
  const insert = `![](${link})`;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}
