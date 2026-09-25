// Find (Ctrl+F) and replace (Ctrl+H): a custom panel on top of @codemirror/search,
// built from native inputs and buttons so minium styles it.
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, type Panel, type ViewUpdate } from "@codemirror/view";

/** Stop counting beyond this many matches; the count shows "999+". */
const MAX_COUNTED = 999;

const panels = new WeakMap<EditorView, FindPanel>();

type Toggle = "caseSensitive" | "wholeWord" | "regexp";

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly find: HTMLInputElement;
  private readonly replace: HTMLInputElement;
  private readonly replaceRow: HTMLElement;
  private readonly count: HTMLOutputElement;
  private readonly toggles = new Map<Toggle, HTMLButtonElement>();

  constructor(private readonly view: EditorView) {
    this.find = input("Find");
    this.find.setAttribute("main-field", "true"); // focused by openSearchPanel
    this.replace = input("Replace");
    this.count = document.createElement("output");
    this.count.className = "find-count";

    const findRow = row(
      this.find,
      this.toggle("caseSensitive", "Aa", "Match case"),
      this.toggle("wholeWord", "W", "Whole word"),
      this.toggle("regexp", ".*", "Regular expression"),
      this.count,
      button("↑", "Previous match (Shift+Enter)", () => findPrevious(view)),
      button("↓", "Next match (Enter)", () => findNext(view)),
      button("×", "Close (Escape)", () => this.close()),
    );
    this.replaceRow = row(
      this.replace,
      button("Replace", "Replace (Enter)", () => replaceNext(view), true),
      button("All", "Replace all (Ctrl+Alt+Enter)", () => replaceAll(view), true),
    );
    this.replaceRow.hidden = true;

    this.dom = document.createElement("div");
    this.dom.className = "find-panel";
    this.dom.setAttribute("role", "search");
    this.dom.append(findRow, this.replaceRow);

    this.find.addEventListener("input", () => this.commit());
    this.replace.addEventListener("input", () => this.commit());
    this.dom.addEventListener("keydown", (e) => this.keydown(e));

    this.show(getSearchQuery(view.state));
    panels.set(view, this);
  }

  mount(): void {
    this.updateCount();
  }

  update(update: ViewUpdate): void {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query())) this.show(effect.value);
      }
    }
    if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.length)) {
      this.updateCount();
    }
  }

  destroy(): void {
    panels.delete(this.view);
  }

  showReplace(show: boolean): void {
    this.replaceRow.hidden = !show;
    (show ? this.replace : this.find).focus();
    if (!show) this.find.select();
  }

  private close(): void {
    closeSearchPanel(this.view);
    this.view.focus();
  }

  private keydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "Enter" && e.target === this.find) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === "Enter" && e.target === this.replace) {
      e.preventDefault();
      (e.ctrlKey && e.altKey ? replaceAll : replaceNext)(this.view);
    }
  }

  private toggle(name: Toggle, label: string, title: string): HTMLButtonElement {
    const b = button(label, title, () => {
      b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      this.commit();
    });
    b.setAttribute("aria-pressed", "false");
    this.toggles.set(name, b);
    return b;
  }

  private pressed(name: Toggle): boolean {
    return this.toggles.get(name)!.getAttribute("aria-pressed") === "true";
  }

  private query(): SearchQuery {
    return new SearchQuery({
      search: this.find.value,
      replace: this.replace.value,
      caseSensitive: this.pressed("caseSensitive"),
      wholeWord: this.pressed("wholeWord"),
      regexp: this.pressed("regexp"),
    });
  }

  private show(query: SearchQuery): void {
    this.find.value = query.search;
    this.replace.value = query.replace;
    this.toggles.get("caseSensitive")!.setAttribute("aria-pressed", String(query.caseSensitive));
    this.toggles.get("wholeWord")!.setAttribute("aria-pressed", String(query.wholeWord));
    this.toggles.get("regexp")!.setAttribute("aria-pressed", String(query.regexp));
  }

  private commit(): void {
    const query = this.query();
    if (!query.eq(getSearchQuery(this.view.state))) {
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  private updateCount(): void {
    const query = getSearchQuery(this.view.state);
    // Only flag errors: minium styles aria-invalid="false" as a success state.
    this.find.toggleAttribute("aria-invalid", query.search !== "" && !query.valid);
    if (!query.search || !query.valid) {
      this.count.value = "";
      return;
    }
    const { from, to } = this.view.state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(this.view.state);
    for (let m = cursor.next(); !m.done && total <= MAX_COUNTED; m = cursor.next()) {
      total++;
      if (m.value.from === from && m.value.to === to) current = total;
    }
    const totalText = total > MAX_COUNTED ? `${MAX_COUNTED}+` : String(total);
    this.count.value = total === 0 ? "No results" : current ? `${current} of ${totalText}` : `${totalText} found`;
  }
}

function input(label: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.placeholder = label;
  el.setAttribute("aria-label", label);
  el.spellcheck = false;
  el.autocomplete = "off";
  return el;
}

function button(label: string, title: string, run: () => void, text = false): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = text ? "secondary small" : "tertiary small icon-button";
  el.textContent = label;
  el.title = title;
  el.addEventListener("click", run);
  return el;
}

function row(...children: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "find-row";
  el.append(...children);
  return el;
}

/** Open the panel; `withReplace` also shows the replace field and focuses it. */
export function openFind(view: EditorView, withReplace: boolean): void {
  if (searchPanelOpen(view.state)) {
    // Already open: search for the newly selected text, as Typora does.
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    if (selected && !selected.includes("\n")) {
      const current = getSearchQuery(view.state);
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ ...current, search: selected, replace: current.replace })),
      });
    }
  } else {
    openSearchPanel(view);
  }
  panels.get(view)?.showReplace(withReplace);
}

export const findReplace: Extension = [
  search({ createPanel: (view) => new FindPanel(view), top: true }),
  keymap.of([
    { key: "F3", run: findNext, shift: findPrevious, preventDefault: true },
    { key: "Mod-g", run: findNext, shift: findPrevious, preventDefault: true },
  ]),
];
