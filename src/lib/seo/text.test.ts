import { describe, expect, it } from "vitest";
import { DESCRIPTION_MAX, joinList, metaDescription, metaTitle, truncate } from "./text";

describe("truncate", () => {
  it("keeps short text and collapses whitespace", () => {
    expect(truncate("  a \n b  ", 10)).toBe("a b");
  });
  it("cuts on a word boundary with an ellipsis", () => {
    expect(truncate("The quick brown fox jumps over the lazy dog", 20)).toBe("The quick brown fox…");
  });
  it("cuts hard when a single word is too long", () => {
    expect(truncate("Supercalifragilisticexpialidocious", 10)).toBe("Supercali…");
  });
  it("never exceeds the maximum and drops trailing punctuation", () => {
    const out = truncate("One, two, three, four, five, six, seven, eight", 17);
    expect(out.length).toBeLessThanOrEqual(17);
    expect(out).toBe("One, two, three…");
  });
});

describe("metaDescription / metaTitle", () => {
  it("takes the first non-empty candidate", () => {
    expect(metaDescription(null, "  ", undefined, "Second", "Third")).toBe("Second");
    expect(metaDescription(null, "")).toBeUndefined();
  });
  it("limits descriptions to 160 characters", () => {
    expect(metaDescription("word ".repeat(100))!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
  it("limits titles", () => {
    expect(metaTitle("x".repeat(100)).length).toBe(70);
    expect(metaTitle(null, "Helmet")).toBe("Helmet");
  });
});

describe("joinList", () => {
  it("joins English-style", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
