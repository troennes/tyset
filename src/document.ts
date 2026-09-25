// One open document: its path, what is known to be on disk, and auto-save.
import { ask } from "@tauri-apps/plugin-dialog";
import { pathExists, readFile, writeFile } from "./api";

const AUTOSAVE_DELAY_MS = 1000;

/** What an external change means for the editor. */
export type ExternalChange = { kind: "reload"; text: string } | { kind: "deleted" } | null;

export type SaveState = "saved" | "pending" | "saving" | "error";

export class Doc {
  /** Content we last wrote to (or read from) disk. */
  private onDisk: string;
  private timer: number | undefined;
  /** Serialises writes so an older save can never land after a newer one. */
  private writing: Promise<void> = Promise.resolve();
  /** True while asking whether to reload; saving then would clobber the disk version. */
  private prompting = false;
  state: SaveState = "saved";
  error: string | null = null;

  constructor(
    private currentPath: string,
    contents: string,
    private readonly getText: () => string,
    private readonly onStateChange: (doc: Doc) => void,
  ) {
    this.onDisk = contents;
  }

  static async open(
    path: string,
    getText: () => string,
    onStateChange: (doc: Doc) => void,
  ): Promise<{ doc: Doc; contents: string }> {
    const contents = await readFile(path);
    return { doc: new Doc(path, contents, getText, onStateChange), contents };
  }

  get path(): string {
    return this.currentPath;
  }

  /** The file was renamed (by us): keep editing it under its new path. */
  moveTo(path: string): void {
    this.currentPath = path;
    this.onStateChange(this);
  }

  get name(): string {
    return this.path.split(/[\\/]/).pop() ?? this.path;
  }

  get dirty(): boolean {
    return this.getText() !== this.onDisk;
  }

  /** Call on every edit; saves once typing pauses. */
  changed(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
    this.setState(this.dirty ? "pending" : "saved");
  }

  /** Save now if there are unsaved edits. Resolves once the write is on disk. */
  save(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.writing = this.writing.then(async () => {
      if (this.prompting) return;
      const text = this.getText();
      if (text === this.onDisk) {
        if (this.state !== "error") this.setState("saved");
        return;
      }
      this.setState("saving");
      try {
        await writeFile(this.path, text);
        this.onDisk = text;
        this.error = null;
        // Typing may have continued while the write was in flight.
        this.setState(this.dirty ? "pending" : "saved");
      } catch (e) {
        this.error = String(e);
        this.setState("error");
      }
    });
    return this.writing;
  }

  /**
   * The file changed on disk: new contents to load, a deletion (the editor keeps
   * its text), or null when there is nothing to do (e.g. it was our own write).
   */
  async externalChange(): Promise<ExternalChange> {
    if (this.prompting) return null;
    await this.writing;
    const disk = await readFile(this.path).catch(() => null);
    if (disk === null) return (await pathExists(this.path)) ? null : { kind: "deleted" };
    if (disk === this.onDisk) return null; // our own write
    if (!this.dirty) return this.reloaded(disk);

    // Hold auto-save while asking: the dialog itself blurs the window.
    this.prompting = true;
    window.clearTimeout(this.timer);
    let reload = false;
    try {
      reload = await ask(`${this.name} changed on disk. Discard your unsaved edits and reload it?`, {
        title: "File changed",
        kind: "warning",
        okLabel: "Reload",
        cancelLabel: "Keep my edits",
      });
      if (!reload) return null;
      return this.reloaded((await readFile(this.path).catch(() => null)) ?? disk);
    } finally {
      this.prompting = false;
      if (!reload) this.changed(); // Kept our edits: save them over the disk version.
    }
  }

  private reloaded(disk: string): ExternalChange {
    this.onDisk = disk;
    window.clearTimeout(this.timer);
    this.setState("saved");
    return { kind: "reload", text: disk };
  }

  private setState(state: SaveState): void {
    this.state = state;
    this.onStateChange(this);
  }
}
