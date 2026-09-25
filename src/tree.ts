// Sidebar file tree, rendered as a minium side menu (aside > nav > ul).
// Right-click (or F2 / Delete) renames an entry in place or moves it to the trash.
import type { TreeNode } from "./api";

export interface TreeActions {
  open(path: string): void;
  /** Resolves when done; the tree redraws from the file watcher. */
  rename(path: string, name: string): Promise<void>;
  trash(path: string, isFolder: boolean): Promise<void>;
}

export class FileTree {
  /** Directory paths the user has expanded; survives re-renders. */
  private expanded = new Set<string>();
  private current: string | null = null;
  private nodes: TreeNode[] = [];
  private readonly menu: HTMLElement;
  /** The entry the context menu was opened for. */
  private menuTarget: { path: string; isFolder: boolean } | null = null;

  constructor(
    private readonly nav: HTMLElement,
    private readonly actions: TreeActions,
  ) {
    nav.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("input")) {
        e.preventDefault(); // typing a new name: don't open or toggle
        return;
      }
      const button = target.closest<HTMLButtonElement>("button[data-path]");
      if (button) actions.open(button.dataset.path!);
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
    nav.addEventListener("contextmenu", (e) => this.contextMenu(e));
    nav.addEventListener("keydown", (e) => this.keydown(e));

    this.menu = document.createElement("div");
    this.menu.className = "tree-menu";
    // "manual": on Linux contextmenu fires on mouse-down, and an "auto" popover
    // would be light-dismissed by the mouse-up that follows. Dismissal is handled below.
    this.menu.popover = "manual";
    this.menu.append(menuItem("rename", "Rename…", "F2"), menuItem("trash", "Move to Trash", "Delete"));
    this.menu.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      const target = this.menuTarget;
      this.menu.hidePopover();
      if (!target) return;
      if (action === "rename") this.startRename(target.path);
      if (action === "trash") void actions.trash(target.path, target.isFolder);
    });
    document.body.append(this.menu);
    const dismiss = () => {
      if (this.menu.matches(":popover-open")) this.menu.hidePopover();
    };
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.contains(e.target as Node)) dismiss();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismiss();
    });
    window.addEventListener("blur", dismiss);
  }

  render(nodes: TreeNode[]): void {
    this.nodes = nodes;
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

  /** A folder was renamed: keep it (and its subfolders) expanded under the new name. */
  renamed(from: string, to: string): void {
    for (const path of [...this.expanded]) {
      if (path === from || isInside(path, from)) {
        this.expanded.delete(path);
        this.expanded.add(to + path.slice(from.length));
      }
    }
  }

  private markCurrent(): void {
    for (const button of this.nav.querySelectorAll<HTMLButtonElement>("button[data-path]")) {
      if (button.dataset.path === this.current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  /** The entry an event happened on: a file button or a folder's summary. */
  private entryAt(target: EventTarget | null): { path: string; isFolder: boolean; el: HTMLElement } | null {
    const el = target instanceof Element ? target : null;
    const file = el?.closest<HTMLElement>("button[data-path]");
    if (file) return { path: file.dataset.path!, isFolder: false, el: file };
    const summary = el?.closest<HTMLElement>("summary");
    const folder = summary?.parentElement as HTMLElement | null;
    if (summary && folder?.dataset.path) return { path: folder.dataset.path, isFolder: true, el: summary };
    return null;
  }

  private contextMenu(e: MouseEvent): void {
    const entry = this.entryAt(e.target);
    if (!entry) return;
    e.preventDefault();
    this.menuTarget = { path: entry.path, isFolder: entry.isFolder };
    this.menu.style.left = `${e.clientX}px`;
    this.menu.style.top = `${e.clientY}px`;
    if (!this.menu.matches(":popover-open")) this.menu.showPopover();
    this.menu.querySelector("button")?.focus();
  }

  private keydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest("input")) return;
    const entry = this.entryAt(e.target);
    if (!entry) return;
    if (e.key === "F2") {
      e.preventDefault();
      this.startRename(entry.path);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void this.actions.trash(entry.path, entry.isFolder);
    }
  }

  /** Swap the entry's label for a text field; Enter renames, Escape cancels. */
  startRename(path: string): void {
    const entry = this.findEntry(path);
    if (!entry) return;
    const name = entry.textContent ?? "";
    const input = document.createElement("input");
    input.className = "tree-rename";
    input.value = name;
    input.setAttribute("aria-label", `Rename ${name}`);
    input.spellcheck = false;
    entry.replaceChildren(input);
    input.focus();
    // Select the name without its extension, like file managers do.
    const dot = name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 && entry.tagName === "BUTTON" ? dot : name.length);

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (commit && value && value !== name) {
        void this.actions.rename(path, value).finally(() => this.render(this.nodes));
      } else {
        this.render(this.nodes);
      }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep Space/Enter from toggling a folder
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("keyup", (e) => e.preventDefault()); // Space in a summary toggles on keyup
    input.addEventListener("blur", () => finish(true));
  }

  private findEntry(path: string): HTMLElement | null {
    for (const el of this.nav.querySelectorAll<HTMLElement>("button[data-path], details[data-path]")) {
      if (el.dataset.path !== path) continue;
      return el.tagName === "DETAILS" ? el.querySelector<HTMLElement>(":scope > summary") : el;
    }
    return null;
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

function menuItem(action: string, label: string, key: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  const text = document.createElement("span");
  text.textContent = label;
  const kbd = document.createElement("kbd");
  kbd.textContent = key;
  button.append(text, kbd);
  return button;
}

function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir) && /[\\/]/.test(path.charAt(dir.length));
}
