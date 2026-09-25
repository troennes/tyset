import "./styles.css";

import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EditorView } from "@codemirror/view";

import { importImageFile, initialPath, listTree, onFsChange, pasteClipboardImage, watchFolder } from "./api";
import { Doc } from "./document";
import {
  type EditorHost,
  createEditor,
  insertImage,
  isSourceMode,
  loadDocument,
  openFind,
  replaceDocument,
  setSourceMode,
} from "./editor";
import { baseName, dirName, isAbsolute, resolve } from "./paths";
import { FileTree } from "./tree";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];
const DOCUMENT_FILE = /\.(md|markdown|txt)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const TREE_REFRESH_DELAY_MS = 200;

const appWindow = getCurrentWindow();
const shell = document.querySelector<HTMLElement>(".shell")!;
const folderName = document.getElementById("folder-name")!;
const status = document.getElementById("save-state")!;
const modeLabel = document.getElementById("mode")!;

let folder: string | null = null;
let doc: Doc | null = null;
let lastTreeJson = "";
let treeTimer: number | undefined;

const host: EditorHost = {
  onChange: () => doc?.changed(),
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

// --- Folder and file handling -------------------------------------------------

async function openFolder(path: string): Promise<void> {
  folder = path;
  folderName.textContent = baseName(path);
  folderName.title = path;
  lastTreeJson = "";
  await refreshTree();
  await watchFolder(path);
  remember("folder", path);
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
  tree.setCurrent(path);
  renderState(doc);
  remember("file", path);
  view.focus();
}

onFsChange(async ({ paths }) => {
  window.clearTimeout(treeTimer);
  treeTimer = window.setTimeout(() => void refreshTree(), TREE_REFRESH_DELAY_MS);
  if (doc && paths.includes(doc.path)) {
    const current = doc;
    const text = await current.externalChange();
    if (text !== null && doc === current) replaceDocument(view, text, host);
  }
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

function toggleSourceMode(): void {
  setSourceMode(view, host, !isSourceMode());
  renderMode();
  remember("sourceMode", String(isSourceMode()));
}

function renderMode(): void {
  modeLabel.textContent = isSourceMode() ? "Source" : "";
}

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
      : key === "l" && e.shiftKey ? () => shell.classList.toggle("no-sidebar")
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
  await doc?.save();
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
  if (recall("sourceMode") === "true") setSourceMode(view, host, true);
  renderMode();
  const cliPath = await initialPath();
  if (cliPath) {
    await openFolder(dirName(cliPath));
    await openFile(cliPath);
    return;
  }
  const lastFolder = recall("folder");
  if (lastFolder) await openFolder(lastFolder).catch(() => undefined);
  const lastFile = recall("file");
  if (lastFile) await openFile(lastFile);
}

void start();

// --- Helpers ------------------------------------------------------------------

function safeDecode(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

// Per-window conveniences only; real settings arrive in milestone 4.
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`tyset.${key}`, value);
  } catch {
    /* storage unavailable */
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(`tyset.${key}`);
  } catch {
    return null;
  }
}
