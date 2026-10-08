import { describe, expect, it } from "vitest";
import { splitUnderstood } from "./highlight";

describe("splitUnderstood", () => {
  it("marks the matched words of every chip", () => {
    expect(splitUnderstood("duitse helm ww2 onder 500", ["duitse", "ww2", "onder 500"])).toEqual([
      { text: "duitse", understood: true },
      { text: " helm ", understood: false },
      { text: "ww2", understood: true },
      { text: " ", understood: false },
      { text: "onder 500", understood: true },
    ]);
  });

  it("is case-insensitive, needs whole words and ignores empty matches", () => {
    expect(splitUnderstood("Helm WWII", ["ww", "", "helm"])).toEqual([
      { text: "Helm", understood: true },
      { text: " WWII", understood: false },
    ]);
    expect(splitUnderstood("helm", [])).toEqual([{ text: "helm", understood: false }]);
  });
});
