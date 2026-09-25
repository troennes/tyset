import "./styles.css";

import { ask, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorView } from "@codemirror/view";

import { initialPath, listTree, onFsChange, watchFolder } from "./api";
import { Doc } from "./document";
import { createEditor, loadDocument, replaceDocument } from "./editor";
import { FileTree } from "./tree";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "txt"];
const TREE_REFRESH_DELAY_MS = 200;

const appWindow = getCurrentWindow();
const shell = document.querySelector<HTMLElement>(".shell")!;
const folderName = document.getElementById("folder-name")!;
const status = document.getElementById("status")!;

let folder: string | null = null;
let doc: Doc | null = null;
let lastTreeJson = "";
let treeTimer: number | undefined;

const onEdit = () => doc?.changed();
const view: EditorView = createEditor(document.getElementById("editor")!, onEdit);
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
    const opened = await Doc.open(path, () => view.state.doc.toString(), renderState);
    doc = opened.doc;
    loadDocument(view, opened.contents, onEdit);
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
    if (text !== null && doc === current) replaceDocument(view, text);
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

// Capture phase so these win over the editor's own keymap.
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
  const cliPath = await initialPath();
  if (cliPath) {
    await openFolder(parentDir(cliPath));
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

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function parentDir(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "") || path;
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
