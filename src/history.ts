// The local history dialog: pick an earlier version of the file and restore it.
import { type Snapshot, listHistory, readHistory } from "./api";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function ago(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export class HistoryDialog {
  private readonly dialog = document.getElementById("history") as HTMLDialogElement;
  private readonly title = document.getElementById("history-title")!;
  private readonly list = document.getElementById("history-list")!;
  private readonly preview = document.getElementById("history-preview")!;
  private readonly restore = document.getElementById("history-restore") as HTMLButtonElement;
  private path = "";
  private selected: string | null = null;
  private selectedText = "";

  constructor(onRestore: (text: string) => void) {
    this.list.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (button) void this.select(button.dataset.id!);
    });
    this.dialog.addEventListener("close", () => {
      if (this.dialog.returnValue === "restore" && this.selected) onRestore(this.selectedText);
    });
  }

  async open(path: string, name: string): Promise<void> {
    this.path = path;
    this.selected = null;
    this.title.textContent = `History of ${name}`;
    this.preview.textContent = "";
    this.restore.disabled = true;
    this.dialog.returnValue = "";
    let snapshots: Snapshot[] = [];
    try {
      snapshots = await listHistory(path);
    } catch (e) {
      this.preview.textContent = `Could not read history: ${e}`;
    }
    this.list.replaceChildren(...snapshots.map((s) => this.item(s)));
    if (!snapshots.length) {
      this.preview.textContent =
        "No earlier versions yet. While you edit, Tyset keeps a copy of the file every few minutes.";
    }
    this.dialog.showModal();
    if (snapshots.length) await this.select(snapshots[0].id);
  }

  private item(snapshot: Snapshot): HTMLLIElement {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = snapshot.id;
    const when = document.createElement("strong");
    when.textContent = ago(snapshot.saved);
    const detail = document.createElement("small");
    detail.textContent = `${absolute.format(snapshot.saved)} · ${formatSize(snapshot.size)}`;
    button.append(when, detail);
    li.append(button);
    return li;
  }

  private async select(id: string): Promise<void> {
    this.selected = id;
    for (const button of this.list.querySelectorAll<HTMLButtonElement>("button[data-id]")) {
      if (button.dataset.id === id) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    try {
      this.selectedText = await readHistory(this.path, id);
      if (this.selected !== id) return; // another version was picked meanwhile
      this.preview.textContent = this.selectedText;
      this.restore.disabled = false;
    } catch (e) {
      this.preview.textContent = `Could not read this version: ${e}`;
      this.restore.disabled = true;
    }
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
