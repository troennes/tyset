// Sidebar file tree, rendered as a minium side menu (aside > nav > ul).
import type { TreeNode } from "./api";

export class FileTree {
  /** Directory paths the user has expanded; survives re-renders. */
  private expanded = new Set<string>();
  private current: string | null = null;

  constructor(
    private readonly nav: HTMLElement,
    onOpen: (path: string) => void,
  ) {
    nav.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-path]");
      if (button) onOpen(button.dataset.path!);
    });
    nav.addEventListener(
      "toggle",
      (e) => {
        const details = e.target as HTMLDetailsElement;
        const path = details.dataset.path!;
        if (details.open) this.expanded.add(path);
        else this.expanded.delete(path);
      },
      true, // toggle does not bubble
    );
  }

  render(nodes: TreeNode[]): void {
    this.nav.replaceChildren(this.list(nodes));
    this.markCurrent();
  }

  setCurrent(path: string | null): void {
    this.current = path;
    // Reveal the file by expanding its ancestors.
    if (path) {
      for (const details of this.nav.querySelectorAll<HTMLDetailsElement>("details[data-path]")) {
        if (isInside(path, details.dataset.path!)) details.open = true;
      }
    }
    this.markCurrent();
  }

  private markCurrent(): void {
    for (const button of this.nav.querySelectorAll<HTMLButtonElement>("button[data-path]")) {
      if (button.dataset.path === this.current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  private list(nodes: TreeNode[]): HTMLUListElement {
    const ul = document.createElement("ul");
    for (const node of nodes) {
      const li = document.createElement("li");
      if (node.children) {
        const details = document.createElement("details");
        details.dataset.path = node.path;
        details.open = this.expanded.has(node.path);
        const summary = document.createElement("summary");
        summary.textContent = node.name;
        details.append(summary, this.list(node.children));
        li.append(details);
      } else {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.path = node.path;
        button.textContent = node.name;
        button.title = node.path;
        li.append(button);
      }
      ul.append(li);
    }
    return ul;
  }
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir) && /[\\/]/.test(path.charAt(dir.length));
}
