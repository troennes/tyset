import { describe, expect, it } from "vitest";

import { addRecent, displayDir, removeRecent } from "./recent";

describe("addRecent", () => {
  it("puts the path first without duplicates", () => {
    expect(addRecent([], "/a.md")).toEqual(["/a.md"]);
    expect(addRecent(["/a.md", "/b.md", "/c.md"], "/b.md")).toEqual(["/b.md", "/a.md", "/c.md"]);
    expect(addRecent(["/a.md"], "/a.md")).toEqual(["/a.md"]);
  });

  it("keeps only the newest entries", () => {
    expect(addRecent(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
    expect(addRecent(Array.from({ length: 10 }, (_, i) => `/${i}`), "/new")).toHaveLength(10);
  });
});

describe("removeRecent", () => {
  it("drops the path", () => {
    expect(removeRecent(["/a", "/b"], "/a")).toEqual(["/b"]);
    expect(removeRecent(["/a"], "/x")).toEqual(["/a"]);
  });
});

describe("displayDir", () => {
  it("shortens the home directory", () => {
    expect(displayDir("/home/kim/notes", "/home/kim")).toBe("~/notes");
    expect(displayDir("/home/kim", "/home/kim/")).toBe("~");
    expect(displayDir("C:\\Users\\kim\\notes", "C:\\Users\\kim")).toBe("~\\notes");
  });

  it("leaves other folders alone", () => {
    expect(displayDir("/home/kimberly", "/home/kim")).toBe("/home/kimberly");
    expect(displayDir("/srv/notes", "/home/kim")).toBe("/srv/notes");
    expect(displayDir("/srv/notes", null)).toBe("/srv/notes");
  });
});
