// The keyboard shortcuts dialog (F1, or "Shortcuts" in the status bar).
// Keys are labelled as pressed on a Norwegian keyboard: ' is the key left of Enter, / is Shift+7.
// Keep this list in step with the keymaps in main.ts, editor/index.ts, editor/search.ts,
// editor/table.ts and tree.ts.

type Shortcut = [action: string, ...keys: string[]];

// Two columns, balanced by hand. Each group is a titled table.
const columns: [title: string, shortcuts: Shortcut[]][][] = [
  [
    [
      "File",
      [
        ["New file", "Ctrl+N"],
        ["Open file", "Ctrl+O"],
        ["Open folder", "Ctrl+Shift+O"],
        ["Save", "Ctrl+S"],
        ["Rename file", "F2"],
        ["New window", "Ctrl+Shift+N"],
        ["Export HTML", "Ctrl+Shift+E"],
        ["Print or PDF", "Ctrl+P"],
      ],
    ],
    [
      "View",
      [
        ["Show or hide sidebar", "Ctrl+Shift+L"],
        ["Source mode", "Ctrl+Shift+7"],
        ["Keyboard shortcuts", "F1"],
      ],
    ],
    [
      "Find and replace",
      [
        ["Find", "Ctrl+F"],
        ["Replace", "Ctrl+H"],
        ["Next match", "F3", "Ctrl+G"],
        ["Previous match", "Shift+F3", "Ctrl+Shift+G"],
        ["Replace all", "Ctrl+Alt+Enter"],
        ["Close", "Esc"],
      ],
    ],
  ],
  [
    [
      "Formatting",
      [
        ["Bold", "Ctrl+B"],
        ["Italic", "Ctrl+I"],
        ["Inline code", "Ctrl+'"],
        ["Code block", "Ctrl+Shift+'"],
        ["Heading 1–6", "Ctrl+1…6"],
        ["Paragraph", "Ctrl+0"],
        ["Link", "Ctrl+K"],
        ["Accordion", "Ctrl+Shift+D"],
        ["Table", "Ctrl+T"],
        ["Paste image", "Ctrl+V"],
        ["Open link", "Ctrl+Click"],
      ],
    ],
    [
      "Tables",
      [
        ["Next or previous cell", "Tab", "Shift+Tab"],
        ["Cell below", "Enter"],
        ["Add row below", "Ctrl+Enter"],
        ["Delete row", "Ctrl+Shift+Backspace"],
        ["Leave table", "Esc"],
      ],
    ],
    [
      "File tree",
      [
        ["Rename", "F2"],
        ["Move to trash", "Delete"],
      ],
    ],
  ],
];

const dialog = document.getElementById("shortcuts") as HTMLDialogElement;

export function openShortcuts(): void {
  const body = dialog.querySelector(".shortcuts-body")!;
  if (!body.childElementCount) {
    body.append(
      ...columns.map((groups) => {
        const column = document.createElement("div");
        column.append(...groups.map(([title, shortcuts]) => table(title, shortcuts)));
        return column;
      }),
    );
  }
  if (!dialog.open) dialog.showModal();
}

function table(title: string, shortcuts: Shortcut[]): HTMLTableElement {
  const table = document.createElement("table");
  table.createCaption().textContent = title;
  for (const [action, ...keys] of shortcuts) {
    const row = table.insertRow();
    row.insertCell().textContent = action;
    const cell = row.insertCell();
    keys.forEach((combo, i) => {
      if (i) cell.append(" or ");
      combo.split("+").forEach((key, j) => {
        if (j) cell.append("+");
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        cell.append(kbd);
      });
    });
  }
  return table;
}
