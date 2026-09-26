// Export: render the document as HTML (via comrak in Rust), make it safe,
// style it like the editor, and save it as a file or print it (Save as PDF).
import { invoke } from "@tauri-apps/api/core";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import minium from "@troennes/minium/min?raw";
import miniumPackage from "@troennes/minium/package.json";
import prism from "@troennes/minium/integrations/prism.css?raw";

import { type AlertKind, ALERTS } from "./alerts";
import exportStyles from "./export.css?raw";

/** Elements that could run code, load other pages or break out of the document. */
const UNSAFE_ELEMENTS =
  "script, style, iframe, frame, frameset, object, embed, applet, noembed, noframes, " +
  "link, meta, base, form, input:not([type=checkbox]), button, textarea, select, title, xmp, plaintext, template";
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href"];

/**
 * Remove anything that could execute: unsafe elements, event handlers,
 * `javascript:` URLs. Inline `style` stays (it can't run code; tables and user HTML use it).
 */
export function sanitize(root: Element): void {
  for (const el of root.querySelectorAll(UNSAFE_ELEMENTS)) el.remove();
  for (const el of root.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
      const scriptUrl = URL_ATTRIBUTES.includes(name) && /^(javascript|vbscript|data:text\/html)/.test(value);
      if (name.startsWith("on") || name === "srcdoc" || scriptUrl) el.removeAttribute(attr.name);
    }
  }
}

/** GitHub alerts (`div.markdown-alert-note`, ...) as minium alerts (`.alert.info`, ...). */
function styleAlerts(root: Element): void {
  for (const alert of root.querySelectorAll<HTMLElement>(".markdown-alert")) {
    const kind = [...alert.classList].find((c) => c.startsWith("markdown-alert-"))?.slice("markdown-alert-".length);
    if (kind && kind in ALERTS) alert.classList.add("alert", ALERTS[kind as AlertKind].tone);
  }
}

/** Colour code blocks with the same parsers the editor uses. */
async function highlight(root: Element): Promise<void> {
  for (const pre of root.querySelectorAll<HTMLElement>("pre[lang]")) {
    const name = pre.getAttribute("lang")!;
    const description = LanguageDescription.matchLanguageName(languages, name, true);
    const code = pre.querySelector("code");
    if (!description || !code) continue;
    const support = await description.load().catch(() => null);
    if (!support) continue;
    const text = code.textContent ?? "";
    const tree = support.language.parser.parse(text);
    const out = document.createDocumentFragment();
    highlightCode(
      text,
      tree,
      classHighlighter,
      (chunk, classes) => {
        if (!classes) return void out.append(chunk);
        const span = document.createElement("span");
        span.className = classes;
        span.textContent = chunk;
        out.append(span);
      },
      () => out.append("\n"),
    );
    code.replaceChildren(out);
  }
}

export interface RenderOptions {
  /** Rewrite image sources (e.g. to load local files inside the app when printing). */
  imageUrl?: (src: string) => string;
}

/** The document as safe, styled HTML (the contents of the page's `<main>`). */
export async function renderDocument(markdown: string, options: RenderOptions = {}): Promise<HTMLElement> {
  const html = await invoke<string>("render_markdown", { markdown });
  // DOMParser builds an inert document: nothing in it loads or runs.
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  const body = parsed.body;
  sanitize(body);
  styleAlerts(body);
  await highlight(body);
  if (options.imageUrl) {
    for (const img of body.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src) img.src = options.imageUrl(src);
    }
  }
  const main = document.createElement("main");
  main.className = "container flow tyset-document";
  main.append(...document.adoptNode(body).childNodes);
  return main;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Fonts from minium's pinned CDN copy: right fonts online, system fonts offline, small files. */
function styles(): string {
  const cdn = `https://cdn.jsdelivr.net/npm/@troennes/minium@${miniumPackage.version}/dist/fonts/`;
  return [minium.replace(/url\("fonts\//g, `url("${cdn}`), prism, exportStyles].join("\n");
}

/** A standalone HTML file: one page, CSS inlined, no scripts. */
export function standaloneHtml(title: string, main: HTMLElement): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tyset">
<title>${escapeHtml(title)}</title>
<style>
${styles()}
</style>
</head>
<body>
${main.outerHTML}
</body>
</html>
`;
}

export const writeExport = (path: string, contents: string) => invoke<void>("write_export", { path, contents });

/**
 * Print just the document: show it in a print-only layer, open the system
 * print dialog (which offers Save as PDF), then remove the layer.
 */
export async function printDocument(main: HTMLElement): Promise<void> {
  const layer = document.createElement("div");
  layer.className = "print-layer";
  layer.append(main);
  document.body.append(layer);
  document.body.classList.add("printing");
  try {
    await waitForImages(layer);
    await invoke("print_page");
  } finally {
    // The print dialog may return before the page is captured; clean up a moment later.
    window.setTimeout(() => {
      layer.remove();
      document.body.classList.remove("printing");
    }, 1000);
  }
}

/** Wait (at most 3 s) for images to load so they make it onto the page. */
function waitForImages(root: Element): Promise<unknown> {
  const pending = [...root.querySelectorAll("img")]
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((done) => {
          img.addEventListener("load", () => done(), { once: true });
          img.addEventListener("error", () => done(), { once: true });
        }),
    );
  return Promise.race([Promise.all(pending), new Promise((done) => window.setTimeout(done, 3000))]);
}
