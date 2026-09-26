import "./styles.css";

import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { documentDir, homeDir } from "@tauri-apps/api/path";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EditorView } from "@codemirror/view";

import {
  createDraft,
  importImageFile,
  initialPath,
  listTree,
  newWindow,
  onFsChange,
  pasteClipboardImage,
  pathExists,
  recoverDraft,
  renamePath,
  trashPath,
  watchDocument,
  watchFolder,
} from "./api";
import { Doc } from "./document";
import { suggestFileName } from "./drafts";
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
import { openShortcuts } from "./shortcuts";
import { Outline } from "./outline";
import { baseName, dirName, isAbsolute, resolve } from "./paths";
import { addRecent, displayDir, removeRecent } from "./recent";
import {
  type Settings,
  flushSettings,
  loadSettings,
  settings,
  storedSettings,
  updateSettings,
  updateStoredSetting,
} from "./settings";
import { FileTree } from "./tree";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];
const DOCUMENT_FILE = /\.(md|markdown|txt)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TREE_REFRESH_DELAY_MS = 200;
/** Windows opened with Ctrl+Shift+N always start with a new draft (no crash recovery). */
const BLANK_WINDOW = new URLSearchParams(location.search).has("blank");

const appWindow = getCurrentWindow();
const shell = document.querySelector<HTMLElement>(".shell")!;
const folderName = document.getElementById("folder-name")!;
const status = document.getElementById("save-state")!;
const modeLabel = document.getElementById("mode")!;
const themeButton = document.getElementById("theme-toggle") as HTMLButtonElement;
const historyButton = document.getElementById("history-button") as HTMLButtonElement;
const exportMenu = document.getElementById("export")!;
const openMenu = document.getElementById("open-menu")!;

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
    if (!doc || !(await ensureSaved())) return null;
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
const tree = new FileTree(document.getElementById("tree")!, {
  open: (path) => void openFile(path),
  rename: (path, name) => renameEntry(path, name),
  trash: (path, isFolder) => trashEntry(path, isFolder),
});
const outline = new Outline(document.getElementById("outline")!, view);
const history = new HistoryDialog((text) => {
  restoreText(view, text); // an ordinary edit: Ctrl+Z undoes it
  view.focus();
});

// --- Folder and file handling -------------------------------------------------

/** `remember` adds it to the recent folders: only for folders the user chose. */
async function openFolder(path: string, remember = false): Promise<void> {
  folder = path;
  folderName.textContent = baseName(path);
  folderName.title = path;
  lastTreeJson = "";
  await refreshTree();
  await watchFolder(path);
  updateSettings({ folder: path });
  if (remember) rememberRecent("recentFolders", path);
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

// sliceDoc, unlike doc.toString(), keeps the file's own line endings.
const editorText = () => view.state.sliceDoc();

interface OpenOptions {
  /** Opened on its own (not from the tree): add it to the recent files. */
  recent?: boolean;
  /** Show the file's folder in the sidebar, unless the open folder already holds it. */
  showFolder?: boolean;
}

/** False if it couldn't be opened or the user cancelled. */
async function openFile(path: string, options: OpenOptions = {}): Promise<boolean> {
  if (doc?.path !== path) {
    let opened: { doc: Doc; contents: string };
    try {
      opened = await Doc.open(path, editorText, renderState);
    } catch (e) {
      showError(`Could not open ${path}: ${e}`);
      return false;
    }
    if (!(await releaseDocument())) return false;
    if (options.showFolder && !(folder && isInside(path, folder))) {
      await openFolder(dirName(path)).catch(() => undefined);
    }
    showDocument(opened.doc, opened.contents);
  }
  if (options.recent) rememberRecent("recentFiles", path);
  return true;
}

function showDocument(next: Doc, contents: string): void {
  doc = next;
  loadDocument(view, contents, host);
  shell.classList.add("has-doc");
  historyButton.hidden = false;
  exportMenu.hidden = false;
  tree.setCurrent(next.draft ? null : next.path);
  outline.refresh();
  renderState(next);
  watchOpenDocument();
  view.focus();
}

/** The folder watcher covers files inside it; watch anything else (e.g. a draft) separately. */
function watchOpenDocument(): void {
  const path = doc?.path ?? null;
  void watchDocument(path && !(folder && isInside(path, folder)) ? path : null).catch(() => undefined);
}

/** Close the open document (e.g. it was moved to the trash). */
function closeDocument(): void {
  doc = null;
  loadDocument(view, "", host);
  shell.classList.remove("has-doc");
  historyButton.hidden = true;
  exportMenu.hidden = true;
  status.textContent = "";
  tree.setCurrent(null);
  outline.refresh();
  void watchDocument(null).catch(() => undefined);
  void appWindow.setTitle("Tyset");
}

/** True if `path` is the open document or a folder containing it. */
function holdsDocument(path: string): boolean {
  return !!doc && (doc.path === path || isInside(doc.path, path));
}

async function renameEntry(path: string, name: string): Promise<void> {
  const current = holdsDocument(path) ? doc : null;
  const oldDocPath = current?.path ?? "";
  if (current) {
    await current.save();
    // Point the document at its new path first, so the watcher's event for the
    // old path isn't mistaken for the file being deleted.
    current.moveTo(resolve(dirName(path), name) + oldDocPath.slice(path.length));
  }
  try {
    const newPath = await renamePath(path, name);
    tree.renamed(path, newPath);
    if (current) {
      current.moveTo(newPath + oldDocPath.slice(path.length));
      tree.setCurrent(current.path);
    }
    if (folder === path) await openFolder(newPath); // renamed the open folder itself
  } catch (e) {
    current?.moveTo(oldDocPath);
    showError(`Could not rename: ${e}`);
  }
  await refreshTree();
}

async function trashEntry(path: string, isFolder: boolean): Promise<void> {
  const name = baseName(path);
  const ok = await ask(
    isFolder ? `Move the folder “${name}” and everything in it to the trash?` : `Move “${name}” to the trash?`,
    { title: "Move to Trash", kind: "warning", okLabel: "Move to Trash", cancelLabel: "Cancel" },
  );
  if (!ok) return;
  if (holdsDocument(path)) {
    await doc!.save();
    closeDocument();
  }
  try {
    await trashPath(path);
  } catch (e) {
    showError(String(e));
  }
  await refreshTree();
  if (!doc) await newDraft();
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

// --- New documents and drafts ----------------------------------------------------
// A new document is a draft: an untitled file in the app's drafts folder, auto-saved
// like any other. Saving it (Ctrl+S) asks for a name and moves it there.

async function newFile(): Promise<void> {
  if (await releaseDocument()) await newDraft();
}

async function newDraft(): Promise<void> {
  try {
    showDocument(Doc.draft(await createDraft(), editorText, renderState), "");
  } catch (e) {
    showError(`Could not create a new document: ${e}`);
  }
}

/** Reopen a draft left behind (e.g. by a crash). False if there is none. */
async function recoverLeftoverDraft(): Promise<boolean> {
  try {
    const path = await recoverDraft();
    if (!path) return false;
    const recovered = await Doc.recover(path, editorText, renderState);
    showDocument(recovered.doc, recovered.contents);
    status.textContent = "Recovered unsaved draft";
    return true;
  } catch {
    return false;
  }
}

/**
 * Let go of the open document before showing another or closing: a file is saved,
 * an empty draft is dropped, and for a draft with text the user chooses.
 * False means stay (the user cancelled).
 */
async function releaseDocument(): Promise<boolean> {
  if (!doc) return true;
  if (!doc.draft) {
    await doc.save();
    return true;
  }
  if (view.state.sliceDoc().trim()) {
    const choice = await message("Do you want to save this document?", {
      title: "Unsaved document",
      kind: "warning",
      buttons: { yes: "Save…", no: "Don’t Save", cancel: "Cancel" },
    });
    if (choice === "Save…" || choice === "Yes") return saveDocumentAs();
    if (choice !== "Don’t Save" && choice !== "No") return false;
  }
  await doc.discard().catch((e) => showError(`Could not delete the draft: ${e}`));
  return true;
}

/** A draft must be saved as a file first, e.g. so pasted images have a folder. False if cancelled. */
async function ensureSaved(): Promise<boolean> {
  return !doc?.draft || saveDocumentAs();
}

/** Where Save As and export dialogs start. */
async function defaultPath(name: string): Promise<string> {
  const dir = folder ?? settings().folder ?? (await documentDir().catch(() => null));
  return dir ? resolve(dir, name) : name;
}

/** Ask where to save the draft, then move it there. False if cancelled or it failed. */
async function saveDocumentAs(): Promise<boolean> {
  const current = doc;
  if (!current?.draft) return true;
  let target = await save({
    defaultPath: await defaultPath(suggestFileName(view.state.sliceDoc())),
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (!target) return false;
  if (!DOCUMENT_FILE.test(target)) {
    // The dialog only confirmed replacing the name as typed.
    target += ".md";
    const replace =
      !(await pathExists(target)) ||
      (await ask(`${baseName(target)} already exists. Replace it?`, {
        title: "Save",
        kind: "warning",
        okLabel: "Replace",
        cancelLabel: "Cancel",
      }));
    if (!replace) return false;
  }
  try {
    await current.saveAs(target);
  } catch (e) {
    showError(`Could not save ${baseName(target)}: ${e}`);
    return false;
  }
  rememberRecent("recentFiles", target);
  if (doc !== current) return true;
  if (folder) await refreshTree();
  else await openFolder(dirName(target)).catch(() => undefined);
  tree.setCurrent(target);
  watchOpenDocument();
  return true;
}

// --- Export -------------------------------------------------------------------

async function exportHtml(): Promise<void> {
  if (!doc) return;
  const path = await save({
    defaultPath: doc.draft
      ? await defaultPath(suggestFileName(view.state.sliceDoc()).replace(/\.md$/, ".html"))
      : doc.path.replace(/\.(md|markdown|txt)$/i, "") + ".html",
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
  if (DOCUMENT_FILE.test(path)) await openFile(path, { recent: true });
  else showError(`Tyset only opens web links and markdown files: ${href}`);
}

// Files dropped on the window: images are linked at the drop point, documents are opened.
void getCurrentWebview().onDragDropEvent(async (event) => {
  if (event.payload.type !== "drop") return;
  const { paths, position } = event.payload;
  const documentPath = paths.find((p) => DOCUMENT_FILE.test(p));
  const images = paths.filter((p) => IMAGE_FILE.test(p));
  if (!images.length) {
    if (documentPath) await openFile(documentPath, { recent: true });
    return;
  }
  if (!doc || !(await ensureSaved())) return;
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
  const saved = d.draft ? "Draft" : "Saved";
  const label = { saved, pending: "Edited", saving: "Saving…", error: `Save failed: ${d.error}` }[d.state];
  status.textContent = label;
  status.classList.toggle("error", d.state === "error");
  // A draft with text is unsaved until it has a name, however recently it was backed up.
  const unsaved = d.state !== "saved" || (d.draft && view.state.doc.length > 0);
  void appWindow.setTitle(`${unsaved ? "• " : ""}${d.name} — Tyset`);
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

// --- Open menu and recent items -------------------------------------------------

type RecentKey = "recentFiles" | "recentFolders";

function rememberRecent(key: RecentKey, path: string): void {
  void updateStoredSetting(key, (list) => addRecent(list, path));
}

function forgetRecent(key: RecentKey, path: string): void {
  void updateStoredSetting(key, (list) => removeRecent(list, path));
}

const home = homeDir().catch(() => null);

/** Fill the recent lists as the menu opens. Missing entries are hidden but kept, e.g. for unmounted drives. */
async function renderRecent(): Promise<void> {
  const [homePath, stored] = await Promise.all([home, storedSettings()]);
  const sections = [
    { key: "recentFolders" as const, id: "recent-folders" },
    { key: "recentFiles" as const, id: "recent-files" },
  ];
  await Promise.all(
    sections.map(async ({ key, id }) => {
      const list = stored[key];
      const exists = await Promise.all(list.map((p) => pathExists(p).catch(() => false)));
      const items = list.filter((_, i) => exists[i]).map((path) => recentItem(key, path, homePath));
      const section = document.getElementById(id)!;
      section.querySelector("ul")!.replaceChildren(...items);
      section.hidden = !items.length;
    }),
  );
}

function recentItem(key: RecentKey, path: string, homePath: string | null): HTMLLIElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.recent = key;
  button.dataset.path = path;
  button.title = path;
  const name = document.createElement("span");
  name.textContent = baseName(path);
  const dir = document.createElement("small");
  dir.textContent = displayDir(dirName(path), homePath);
  button.append(name, dir);
  const li = document.createElement("li");
  li.append(button);
  return li;
}

async function openRecent(key: RecentKey, path: string): Promise<void> {
  if (!(await pathExists(path).catch(() => false))) {
    showError(`${baseName(path)} no longer exists`);
    forgetRecent(key, path);
    return;
  }
  if (key === "recentFolders") await openFolder(path, true);
  else await openFile(path, { recent: true, showFolder: true });
}

openMenu.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState === "open") void renderRecent();
});

openMenu.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  openMenu.hidePopover();
  const { open: action, recent, path } = button.dataset;
  if (action === "folder") void pickFolder();
  else if (action === "file") void pickFile();
  else if ((recent === "recentFiles" || recent === "recentFolders") && path) void openRecent(recent, path);
});

// --- Commands -----------------------------------------------------------------

async function pickFolder(): Promise<void> {
  const path = await open({ directory: true });
  if (typeof path === "string") await openFolder(path, true);
}

async function pickFile(): Promise<void> {
  const path = await open({
    defaultPath: folder ?? undefined,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof path === "string") await openFile(path, { recent: true });
}

document.getElementById("shortcuts-button")!.addEventListener("click", openShortcuts);

// F1 shows the keyboard shortcuts.
window.addEventListener("keydown", (e) => {
  if (e.key !== "F1" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  openShortcuts();
});

// F2 renames the open document (in the tree, F2 renames the focused entry instead).
window.addEventListener("keydown", (e) => {
  if (e.key !== "F2" || e.ctrlKey || e.altKey || e.metaKey || !doc) return;
  if ((e.target as HTMLElement).closest("#tree")) return;
  e.preventDefault();
  if (doc.draft) {
    void saveDocumentAs();
    return;
  }
  setSidebar(true);
  showSidebarTab("files");
  tree.setCurrent(doc.path);
  tree.startRename(doc.path);
});

// App-wide shortcuts. Capture phase so they win over the editor's own keymap
// and also work while the sidebar has focus.
window.addEventListener(
  "keydown",
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const command =
      key === "s" && !e.shiftKey ? () => (doc?.draft ? saveDocumentAs() : doc?.save())
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
  if (doc?.draft && !(await releaseDocument())) {
    event.preventDefault();
    return;
  }
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

  const cliPath = BLANK_WINDOW ? null : await initialPath();
  if (cliPath) {
    await openFolder(dirName(cliPath));
    await openFile(cliPath, { recent: true });
    return;
  }
  // Start with an empty document, no folder. Only the first window picks up a leftover draft.
  if (BLANK_WINDOW || !(await recoverLeftoverDraft())) await newDraft();
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
