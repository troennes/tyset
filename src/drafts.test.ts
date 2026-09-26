import { describe, expect, it } from "vitest";

import { suggestFileName } from "./drafts";

describe("suggestFileName", () => {
  it("uses the first heading or line", () => {
    expect(suggestFileName("# Meeting notes\n\ntext")).toBe("Meeting notes.md");
    expect(suggestFileName("\n\n  Shopping list  \nmilk")).toBe("Shopping list.md");
  });

  it("drops markdown syntax", () => {
    expect(suggestFileName("## **Plan** for `v2`")).toBe("Plan for v2.md");
    expect(suggestFileName("- [x] Buy [milk](https://x.no)")).toBe("Buy milk.md");
    expect(suggestFileName("> quote")).toBe("quote.md");
    expect(suggestFileName("---\n\nAfter rule")).toBe("After rule.md");
  });

  it("removes characters files can't have", () => {
    expect(suggestFileName("# Q3: plans/ideas?")).toBe("Q3 plans ideas.md");
    expect(suggestFileName("Ends with a dot.")).toBe("Ends with a dot.md");
  });

  it("shortens long lines and falls back to Untitled", () => {
    expect(suggestFileName("a".repeat(100))).toBe(`${"a".repeat(60)}.md`);
    expect(suggestFileName("")).toBe("Untitled.md");
    expect(suggestFileName("# ***")).toBe("Untitled.md");
  });
});
