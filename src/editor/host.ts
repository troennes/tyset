// What the editor needs from the app around it.

export interface EditorHost {
  /** Called on every user edit (not for reloads from disk). */
  onChange(): void;
  /** Ctrl+click on a link. `href` is the destination as written in the markdown. */
  openLink(href: string): void;
  /** Store the clipboard's image beside the document; resolves to the link path, or null if none. */
  pasteImage(): Promise<string | null>;
  /** Turn an image link (possibly relative to the document) into a URL the page can load. */
  imageUrl(src: string): string;
}
