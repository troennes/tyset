// Widgets drawn in place of markdown syntax by the live preview.
import { EditorView, WidgetType } from "@codemirror/view";

import { type AlertKind, ALERTS } from "../alerts";

export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.textContent = "•";
    return el;
  }
}

/** A task list checkbox. Clicking it edits the `[ ]` / `[x]` in the text. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep focus and selection in the editor
      const pos = view.posAtDOM(box);
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
    });
    box.addEventListener("click", (e) => e.preventDefault()); // the text change re-renders it
    return box;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-image";
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    // The line height changes once the image loads; let CodeMirror re-measure.
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => img.classList.add("cm-image-broken"));
    return img;
  }
  get estimatedHeight(): number {
    return 200;
  }
}

/** The alert's first line, `> [!NOTE]`, as an icon and a label. */
export class AlertLabelWidget extends WidgetType {
  constructor(readonly kind: AlertKind) {
    super();
  }
  eq(other: AlertLabelWidget): boolean {
    return other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-alert-label";
    const icon = document.createElement("span");
    icon.className = "cm-alert-icon";
    icon.style.maskImage = ALERTS[this.kind].icon;
    el.append(icon, ALERTS[this.kind].label);
    return el;
  }
}

export class CodeLanguageWidget extends WidgetType {
  constructor(readonly language: string) {
    super();
  }
  eq(other: CodeLanguageWidget): boolean {
    return other.language === this.language;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-code-language";
    el.textContent = this.language;
    return el;
  }
}

/** The disclosure triangle on an accordion's summary line. */
export class AccordionToggleWidget extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly toggle: (view: EditorView, pos: number) => void,
  ) {
    super();
  }
  eq(other: AccordionToggleWidget): boolean {
    return other.folded === this.folded;
  }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("span");
    button.className = "cm-accordion-toggle";
    button.setAttribute("role", "button");
    button.setAttribute("aria-expanded", String(!this.folded));
    button.title = this.folded ? "Expand" : "Collapse";
    button.textContent = "▸";
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.toggle(view, view.posAtDOM(button));
    });
    return button;
  }
}
