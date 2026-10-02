import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { findTables, renderInline } from "./table";

const ranges = (text: string) =>
  findTables(EditorState.create({ doc: text })).map(({ from, to }) => text.slice(from, to));

describe("findTables", () => {
  it("finds a table and ends it at a blank line", () => {
    expect(ranges("intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter")).toEqual(["| a | b |\n|---|---|\n| 1 | 2 |"]);
  });

  it("continues through lines without pipes, as GFM does", () => {
    expect(ranges("| a |\n|---|\n| 1 |\nloose row\n\nafter")).toEqual(["| a |\n|---|\n| 1 |\nloose row"]);
  });

  it("stops at a new block", () => {
    expect(ranges("| a |\n|---|\n# Heading")).toEqual(["| a |\n|---|"]);
    expect(ranges("| a |\n|---|\n> quote")).toEqual(["| a |\n|---|"]);
  });

  it("needs a matching delimiter row", () => {
    expect(ranges("| a | b |\n|---|\n| 1 | 2 |")).toEqual([]);
    expect(ranges("just | pipes\nno delimiter")).toEqual([]);
  });

  it("ignores tables in code fences, quotes and lists", () => {
    expect(ranges("```\n| a |\n|---|\n```")).toEqual([]);
    expect(ranges("> | a |\n> |---|")).toEqual([]);
    expect(ranges("- | a |\n  |---|")).toEqual([]);
  });
});

describe("renderInline", () => {
  it("renders inline markdown and escapes HTML", () => {
    expect(renderInline("**b** *i* `c*` ~~s~~ <x>")).toBe(
      "<strong>b</strong> <em>i</em> <code>c*</code> <del>s</del> &lt;x&gt;",
    );
    expect(renderInline("[t](https://a.b)")).toBe(
      '<a data-href="https://a.b" title="https://a.b (Ctrl+click to open)">t</a>',
    );
    expect(renderInline("a \\| b")).toBe("a | b");
  });

  it("links bare URLs, autolinks and emails", () => {
    const hrefs = (md: string) => [...renderInline(md).matchAll(/data-href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs("see https://a.b/c_d_e, www.x.org.")).toEqual(["https://a.b/c_d_e", "www.x.org"]);
    expect(hrefs("<https://q.io> me@z.no <you@y.no>")).toEqual(["https://q.io", "mailto:me@z.no", "mailto:you@y.no"]);
    expect(hrefs("`https://in.code`")).toEqual([]);
    expect(hrefs("https://a.b?x=1&y=2")).toEqual(["https://a.b?x=1&amp;y=2"]);
    expect(renderInline("**see [x](https://a.b)**")).toMatch(/^<strong>see <a [^>]+>x<\/a><\/strong>$/);
  });
});
