import "./styles.css";

import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EditorView } from "@codemirror/view";

import {
  createFile,
  importImageFile,
  initialPath,
  listTree,
  newWindow,
  onFsChange,
  pasteClipboardImage,
  watchDocument,
  watchFolder,
} from "./api";
import { Doc } from "./document";
import {
  type EditorHost,
  createEditor,
  insertImage,
  isSourceMode,
  loadDocument,
  openFind,
  replaceDocument,
  restoreText,
  setSourceMode,
} from "./editor";
import { printDocument, renderDocument, standaloneHtml, writeExport } from "./export";
import { HistoryDialog } from "./history";
import { Outline } from "./outline";
import { baseName, dirName, isAbsolute, resolve } from "./paths";
import { type Settings, flushSettings, loadSettings, settings, updateSettings } from "./settings";
import { FileTree } from "./tree";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];
const DOCUMENT_FILE = /\.(md|markdown|txt)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TREE_REFRESH_DELAY_MS = 200;
/** Windows opened with Ctrl+Shift+N start empty instead of restoring the last folder. */
const BLANK_WINDOW = new URLSearchParams(location.search).has("blank");

const appWindow = getCurrentWindow();
const shell = document.querySelector<HTMLElement>(".shell")!;
const folderName = document.getElementById("folder-name")!;
const status = document.getElementById("save-state")!;
const modeLabel = document.getElementById("mode")!;
const themeButton = document.getElementById("theme-toggle") as HTMLButtonElement;
const historyButton = document.getElementById("history-button") as HTMLButtonElement;
const exportMenu = document.getElementById("export")!;

let folder: string | null = null;
let doc: Doc | null = null;
let lastTreeJson = "";
let treeTimer: number | undefined;

const host: EditorHost = {
  onChange: () => doc?.changed(),
  onViewUpdate: (update) => {
    if (update.docChanged) outline.schedule();
    else outline.markCurrent();
  },
  openLink: (href) => void openLink(href),
  pasteImage: async () => {
    if (!doc) return null;
    try {
      return await pasteClipboardImage(doc.path);
    } catch (e) {
      showError(`Could not paste image: ${e}`);
      return null;
    }
  },
  imageUrl: (src) => {
    if (URL_SCHEME.test(src) && !/^file:/i.test(src)) return src; // https:, data:
    const path = src.replace(/^file:\/\//i, "");
    const decoded = safeDecode(path.split(/[?#]/)[0]);
    return convertFileSrc(isAbsolute(decoded) || !doc ? decoded : resolve(dirName(doc.path), decoded));
  },
};
const view: EditorView = createEditor(document.getElementById("editor")!, host);
const tree = new FileTree(document.getElementById("tree")!, (path) => void openFile(path));
const outline = new Outline(document.getElementById("outline")!, view);
const history = new HistoryDialog((text) => {
  restoreText(view, text); // an ordinary edit: Ctrl+Z undoes it
  view.focus();
});

// --- Folder and file handling -------------------------------------------------

async function openFolder(path: string): Promise<void> {
  folder = path;
  folderName.textContent = baseName(path);
  folderName.title = path;
  lastTreeJson = "";
  await refreshTree();
  await watchFolder(path);
  updateSettings({ folder: path });
}

async function refreshTree(): Promise<void> {
  if (!folder) return;
  try {
    const nodes = await listTree(folder);
    const json = JSON.stringify(nodes);
    if (json === lastTreeJson) return; // e.g. our own save: nothing to redraw
    lastTreeJson = json;
    tree.render(nodes);
  } catch (e) {
    showError(`Could not read folder: ${e}`);
  }
}

async function openFile(path: string): Promise<void> {
  if (doc?.path === path) return;
  await doc?.save();
  try {
    // sliceDoc, unlike doc.toString(), keeps the file's own line endings.
    const opened = await Doc.open(path, () => view.state.sliceDoc(), renderState);
    doc = opened.doc;
    loadDocument(view, opened.contents, host);
  } catch (e) {
    showError(`Could not open ${path}: ${e}`);
    return;
  }
  shell.classList.add("has-doc");
  historyButton.hidden = false;
  exportMenu.hidden = false;
  tree.setCurrent(path);
  outline.refresh();
  renderState(doc);
  updateSettings({ file: path });
  // The folder watcher covers files inside it; watch anything else separately.
  void watchDocument(folder && isInside(path, folder) ? null : path).catch(() => undefined);
  view.focus();
}

onFsChange(async ({ paths }) => {
  window.clearTimeout(treeTimer);
  treeTimer = window.setTimeout(() => void refreshTree(), TREE_REFRESH_DELAY_MS);
  if (doc && paths.includes(doc.path)) {
    const current = doc;
    const change = await current.externalChange();
    if (doc !== current || !change) return;
    if (change.kind === "reload") replaceDocument(view, change.text, host);
    else showError(`${current.name} was deleted outside Tyset. Your text is still here; editing saves it again.`);
  }
});

// --- New files and windows -------------------------------------------------------

async function newFile(): Promise<void> {
  const dir = folder ?? (doc ? dirName(doc.path) : undefined);
  const path = await save({
    defaultPath: dir ? resolve(dir, "Untitled.md") : "Untitled.md",
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (!path) return;
  try {
    await createFile(path);
  } catch (e) {
    showError(`Could not create ${path}: ${e}`);
    return;
  }
  await openFile(path);
}

// --- Export -------------------------------------------------------------------

async function exportHtml(): Promise<void> {
  if (!doc) return;
  const path = await save({
    defaultPath: doc.path.replace(/\.(md|markdown|txt)$/i, "") + ".html",
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return;
  try {
    // Relative image links keep working when the file is saved next to the document.
    const main = await renderDocument(view.state.sliceDoc());
    await writeExport(path, standaloneHtml(doc.name.replace(/\.[^.]+$/, ""), main));
    status.classList.remove("error");
    status.textContent = `Exported ${baseName(path)}`;
  } catch (e) {
    showError(`Export failed: ${e}`);
  }
}

async function printPdf(): Promise<void> {
  if (!doc) return;
  try {
    const main = await renderDocument(view.state.sliceDoc(), { imageUrl: host.imageUrl });
    await printDocument(main);
  } catch (e) {
    showError(`Could not print: ${e}`);
  }
}

document.getElementById("export-menu")!.addEventListener("click", (e) => {
  const kind = (e.target as HTMLElement).closest<HTMLElement>("[data-export]")?.dataset.export;
  if (!kind) return;
  (document.getElementById("export-menu") as HTMLElement).hidePopover();
  void (kind === "html" ? exportHtml() : printPdf());
});

// --- Links and images -----------------------------------------------------------

/** Ctrl+click: web links open in the browser, links to markdown files open here. */
async function openLink(href: string): Promise<void> {
  if (/^www\./i.test(href)) href = `https://${href}`;
  if (/^(https?|mailto):/i.test(href)) {
    await openUrl(href).catch((e) => showError(`Could not open link: ${e}`));
    return;
  }
  const target = safeDecode(href.split(/[?#]/)[0]);
  if (!target || !doc) return; // e.g. "#heading": in-page anchors aren't supported yet
  const path = isAbsolute(target) ? target : resolve(dirName(doc.path), target);
  if (DOCUMENT_FILE.test(path)) await openFile(path);
  else showError(`Tyset only opens web links and markdown files: ${href}`);
}

// Files dropped on the window: images are linked at the drop point, documents are opened.
void getCurrentWebview().onDragDropEvent(async (event) => {
  if (event.payload.type !== "drop") return;
  const { paths, position } = event.payload;
  const documentPath = paths.find((p) => DOCUMENT_FILE.test(p));
  const images = paths.filter((p) => IMAGE_FILE.test(p));
  if (!images.length) {
    if (documentPath) await openFile(documentPath);
    return;
  }
  if (!doc) return;
  const ratio = window.devicePixelRatio || 1;
  const at = view.posAtCoords({ x: position.x / ratio, y: position.y / ratio }) ?? undefined;
  for (const image of images.reverse()) {
    try {
      insertImage(view, await importImageFile(doc.path, image), at);
    } catch (e) {
      showError(`Could not add ${baseName(image)}: ${e}`);
    }
  }
});

// --- Status and title ---------------------------------------------------------

function renderState(d: Doc): void {
  if (d !== doc) return;
  const label = { saved: "Saved", pending: "Edited", saving: "Saving…", error: `Save failed: ${d.error}` }[d.state];
  status.textContent = label;
  status.classList.toggle("error", d.state === "error");
  void appWindow.setTitle(`${d.state === "saved" ? "" : "• "}${d.name} — Tyset`);
}

function showError(message: string): void {
  status.textContent = message;
  status.classList.add("error");
}

// --- Sidebar, theme and modes ---------------------------------------------------

function showSidebarTab(tab: Settings["sidebarTab"], remember = true): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  if (remember) updateSettings({ sidebarTab: tab });
}

document.querySelector(".tabs")!.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]")?.dataset.tab;
  if (tab === "files" || tab === "outline") showSidebarTab(tab);
});

function setSidebar(visible: boolean): void {
  shell.classList.toggle("no-sidebar", !visible);
  updateSettings({ sidebar: visible });
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme(): "light" | "dark" {
  return settings().theme ?? (systemDark.matches ? "dark" : "light");
}

/** minium switches colours on `html[data-theme]`; no attribute follows the system. */
function applyTheme(theme: Settings["theme"]): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  void appWindow.setTheme(theme).catch(() => undefined); // native title bar to match
  const dark = effectiveTheme() === "dark";
  themeButton.textContent = dark ? "☀" : "☾";
  themeButton.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function toggleTheme(): void {
  const theme = effectiveTheme() === "dark" ? "light" : "dark";
  updateSettings({ theme });
  applyTheme(theme);
}

themeButton.addEventListener("click", toggleTheme);
systemDark.addEventListener("change", () => applyTheme(settings().theme));

function toggleSourceMode(): void {
  setSourceMode(view, host, !isSourceMode());
  renderMode();
  updateSettings({ sourceMode: isSourceMode() });
}

function renderMode(): void {
  modeLabel.textContent = isSourceMode() ? "Source" : "";
}

historyButton.addEventListener("click", () => void openHistory());

async function openHistory(): Promise<void> {
  if (!doc) return;
  await doc.save(); // so the list is up to date with what's on disk
  await history.open(doc.path, doc.name);
}

// --- Commands -----------------------------------------------------------------

async function pickFolder(): Promise<void> {
  const path = await open({ directory: true });
  if (typeof path === "string") await openFolder(path);
}

async function pickFile(): Promise<void> {
  const path = await open({
    defaultPath: folder ?? undefined,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof path === "string") await openFile(path);
}

document.getElementById("open-folder")!.addEventListener("click", () => void pickFolder());

// App-wide shortcuts. Capture phase so they win over the editor's own keymap
// and also work while the sidebar has focus.
window.addEventListener(
  "keydown",
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const command =
      key === "s" && !e.shiftKey ? () => doc?.save()
      : key === "o" && !e.shiftKey ? pickFile
      : key === "o" && e.shiftKey ? pickFolder
      : key === "n" && !e.shiftKey ? newFile
      : key === "p" && !e.shiftKey ? printPdf
      : key === "e" && e.shiftKey ? exportHtml
      : key === "n" && e.shiftKey ? newWindow
      : key === "l" && e.shiftKey ? () => setSidebar(shell.classList.contains("no-sidebar"))
      : key === "f" && !e.shiftKey && doc ? () => openFind(view, false)
      : key === "h" && !e.shiftKey && doc ? () => openFind(view, true)
      // "/" is Shift+7 on Nordic layouts, so Shift is allowed here.
      : key === "/" ? toggleSourceMode
      : null;
    if (!command) return;
    e.preventDefault();
    e.stopPropagation();
    void command();
  },
  true,
);

// Never lose edits: save when the window loses focus and before it closes.
window.addEventListener("blur", () => void doc?.save());
void appWindow.onCloseRequested(async (event) => {
  await Promise.all([doc?.save(), flushSettings()]);
  if (doc?.state !== "error") return;
  const close = await ask(`Could not save ${doc.name}: ${doc.error}\n\nClose anyway and lose your edits?`, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Close",
    cancelLabel: "Cancel",
  });
  if (!close) event.preventDefault();
});

// --- Startup ------------------------------------------------------------------

async function start(): Promise<void> {
  const saved = await loadSettings();
  applyTheme(saved.theme);
  shell.classList.toggle("no-sidebar", !saved.sidebar);
  showSidebarTab(saved.sidebarTab, false);
  if (saved.sourceMode) setSourceMode(view, host, true);
  renderMode();
  if (BLANK_WINDOW) return;

  const cliPath = await initialPath();
  if (cliPath) {
    await openFolder(dirName(cliPath));
    await openFile(cliPath);
    return;
  }
  if (saved.folder) await openFolder(saved.folder).catch(() => undefined);
  if (saved.file) await openFile(saved.file);
}

void start();

// --- Helpers ------------------------------------------------------------------

function isInside(path: string, dir: string): boolean {
  return path.startsWith(dir) && /[\\/]/.test(path.charAt(dir.length));
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}
