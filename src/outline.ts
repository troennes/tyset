// Sidebar outline: the document's headings; click to jump, current one marked.
import type { EditorView } from "@codemirror/view";

import { type Heading, headings, revealPosition } from "./editor";

const REFRESH_DELAY_MS = 150;

export class Outline {
  private items: Heading[] = [];
  private timer: number | undefined;

  constructor(
    private readonly nav: HTMLElement,
    private readonly view: EditorView,
  ) {
    nav.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
      const heading = button && this.items[Number(button.dataset.index)];
      if (heading) revealPosition(view, heading.from);
    });
  }

  /** Rebuild now (e.g. a new document was loaded). */
  refresh(): void {
    window.clearTimeout(this.timer);
    this.items = headings(this.view.state);
    const ul = document.createElement("ul");
    this.items.forEach((heading, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(index);
      button.style.setProperty("--level", String(heading.level));
      button.textContent = heading.text || "(untitled)";
      button.title = heading.text;
      li.append(button);
      ul.append(li);
    });
    if (!this.items.length) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = "No headings";
      this.nav.replaceChildren(empty);
    } else {
      this.nav.replaceChildren(ul);
    }
    this.markCurrent();
  }

  /** The text changed: rebuild once typing pauses. */
  schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  /** Mark the heading of the section containing the cursor. */
  markCurrent(): void {
    const head = this.view.state.selection.main.head;
    let current = -1;
    this.items.forEach((heading, index) => {
      if (heading.from <= head) current = index;
    });
    for (const button of this.nav.querySelectorAll<HTMLButtonElement>("button[data-index]")) {
      if (Number(button.dataset.index) === current) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
  }
}
