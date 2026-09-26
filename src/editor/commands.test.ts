import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { cycleAlert } from "./commands";

/** Run `command` on `text`, where "|" marks the cursor; returns the result with its cursor. */
function run(command: StateCommand, text: string): string {
  const cursor = text.indexOf("|");
  let state = EditorState.create({
    doc: text.replace("|", ""),
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({ base: markdownLanguage }),
  });
  command({ state, dispatch: (tr) => (state = tr.state) });
  const head = state.selection.main.head;
  return state.sliceDoc(0, head) + "|" + state.sliceDoc(head);
}

describe("cycleAlert", () => {
  it("inserts an empty note on a blank line", () => {
    expect(run(cycleAlert, "intro\n\n|")).toBe("intro\n\n> [!NOTE]\n> |");
  });

  it("keeps a new alert apart from the blocks around it", () => {
    expect(run(cycleAlert, "> quote\n|\nafter")).toBe("> quote\n\n> [!NOTE]\n> |\n\nafter");
    expect(run(cycleAlert, "> quote\n- |item")).toBe("> quote\n\n> [!NOTE]\n> - |item");
  });

  it("quotes the whole paragraph around the cursor", () => {
    expect(run(cycleAlert, "one\nt|wo\n\nafter")).toBe("> [!NOTE]\n> one\n> t|wo\n\nafter");
  });

  it("quotes blank lines inside a block with a bare >", () => {
    expect(run(cycleAlert, "- |a\n\n- b")).toBe("> [!NOTE]\n> - |a\n>\n> - b");
  });

  it("steps to the next kind", () => {
    expect(run(cycleAlert, "> [!NOTE]\n> te|xt")).toBe("> [!TIP]\n> te|xt");
    expect(run(cycleAlert, "> [!warning]\n> |text")).toBe("> [!CAUTION]\n> |text");
  });

  it("turns caution back into plain text", () => {
    expect(run(cycleAlert, "> [!CAUTION]\n> one\n>\n> t|wo\n\nafter")).toBe("one\n\nt|wo\n\nafter");
  });

  it("makes a plain quote a note", () => {
    expect(run(cycleAlert, "> quo|te")).toBe("> [!NOTE]\n> quo|te");
  });

  it("keeps CRLF line endings", () => {
    let state = EditorState.create({
      doc: "text",
      extensions: [EditorState.lineSeparator.of("\r\n"), markdown({ base: markdownLanguage })],
    });
    cycleAlert({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.sliceDoc()).toBe("> [!NOTE]\r\n> text");
  });
});
