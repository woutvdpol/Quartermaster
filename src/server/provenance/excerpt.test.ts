import { describe, expect, it } from "vitest";
import { excerpt, markdownToPlainText } from "./excerpt";

describe("provenance excerpt", () => {
  it("turns Markdown into plain text", () => {
    expect(markdownToPlainText("## From the estate\n\nFound in **Normandy**, see [letter](https://x.nl).\n\n- one\n- two\n\n---")).toBe(
      "From the estate\n\nFound in Normandy, see letter.\n\n• one\n• two",
    );
    expect(markdownToPlainText("  ")).toBe("");
    expect(markdownToPlainText(null)).toBe("");
  });

  it("cuts at a word boundary", () => {
    expect(excerpt("short", 10)).toBe("short");
    expect(excerpt("one two three four five", 12)).toBe("one two…");
  });
});
