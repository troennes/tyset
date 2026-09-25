import { describe, expect, it } from "vitest";

import {
  deleteColumn,
  deleteRow,
  escapeCell,
  formatTable,
  insertColumn,
  insertRow,
  isDelimiterRow,
  parseTable,
  setAlign,
  splitRow,
  unescapeCell,
  withCell,
} from "./tablemodel";

describe("splitRow", () => {
  it("handles optional outer pipes and escaped pipes", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
    expect(splitRow("| | x |")).toEqual(["", "x"]);
  });
});

describe("isDelimiterRow", () => {
  it("recognises alignment rows only", () => {
    expect(isDelimiterRow("| --- | :-: | --: |")).toBe(true);
    expect(isDelimiterRow("---|---")).toBe(true);
    expect(isDelimiterRow("| a | b |")).toBe(false);
    expect(isDelimiterRow("| -- x | --- |")).toBe(false);
  });
});

describe("parse and format", () => {
  const source = ["| Name | Qty |", "|:--|--:|", "| apple | 3 |", "| kiwi |"].join("\n");

  it("parses alignment and pads short rows", () => {
    const t = parseTable(source);
    expect(t.header).toEqual(["Name", "Qty"]);
    expect(t.align).toEqual(["left", "right"]);
    expect(t.rows).toEqual([
      ["apple", "3"],
      ["kiwi", ""],
    ]);
  });

  it("formats as an aligned table", () => {
    expect(formatTable(parseTable(source))).toBe(
      ["| Name  | Qty |", "| :---- | --: |", "| apple |   3 |", "| kiwi  |     |"].join("\n"),
    );
  });

  it("round-trips a formatted table unchanged", () => {
    const formatted = formatTable(parseTable(source));
    expect(formatTable(parseTable(formatted))).toBe(formatted);
  });

  it("uses the document's line break", () => {
    expect(formatTable(parseTable(source), "\r\n").split("\r\n")).toHaveLength(4);
  });

  it("centres and counts wide characters by code point", () => {
    const t = setAlign(parseTable("| a |\n|---|\n| 😀😀😀😀😀 |"), 0, "center");
    expect(formatTable(t).split("\n")[0]).toBe("|   a   |");
  });
});

describe("editing", () => {
  const t = parseTable("| a | b |\n|---|---|\n| 1 | 2 |");

  it("edits cells, rows and columns", () => {
    expect(withCell(t, 0, 1, "B").header).toEqual(["a", "B"]);
    expect(withCell(t, 1, 0, "x").rows).toEqual([["x", "2"]]);
    expect(insertRow(t, 1).rows).toEqual([["", ""], ["1", "2"]]);
    expect(insertRow(t, 2).rows).toEqual([["1", "2"], ["", ""]]);
    expect(deleteRow(t, 1).rows).toEqual([]);
    expect(deleteRow(t, 0)).toBe(t); // header stays
    expect(insertColumn(t, 1).header).toEqual(["a", "", "b"]);
    expect(deleteColumn(t, 0).header).toEqual(["b"]);
    expect(deleteColumn(deleteColumn(t, 0), 0).header).toEqual(["b"]); // last column stays
  });

  it("escapes pipes typed into cells", () => {
    expect(escapeCell("a | b || c")).toBe("a \\| b \\|\\| c");
    expect(escapeCell("already \\| escaped")).toBe("already \\| escaped");
    expect(escapeCell("two\nlines")).toBe("two lines");
    expect(unescapeCell("a \\| b")).toBe("a | b");
  });
});
