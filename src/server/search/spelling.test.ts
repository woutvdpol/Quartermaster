import { describe, expect, it } from "vitest";
import { buildVocabulary, correctWord, didYouMean, editDistance } from "./spelling";

const vocab = buildVocabulary(
  [
    ["stahlhelm", 8],
    ["helmet", 5],
    ["feldbluse", 2],
    ["koppelschloss", 1],
    ["helm", 3],
  ],
  ["Country: Germany", "verrekijker"],
);

describe("spelling", () => {
  it("edit distance with early exit", () => {
    expect(editDistance("stahlhem", "stahlhelm")).toBe(1);
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("abc", "abcdef", 2)).toBe(3);
  });

  it("corrects unknown words to the closest shop word", () => {
    expect(correctWord("stahlhem", vocab)).toBe("stahlhelm");
    expect(correctWord("Feldbluze", vocab)).toBe("feldbluse");
    expect(correctWord("verrekijkr", vocab)).toBe("verrekijker");
    expect(correctWord("germny", vocab)).toBe("germany");
  });

  it("leaves known, short, numeric and far-off words alone", () => {
    expect(correctWord("helm", vocab)).toBeNull();
    expect(correctWord("hlm", vocab)).toBeNull();
    expect(correctWord("1914", vocab)).toBeNull();
    expect(correctWord("submarine", vocab)).toBeNull();
  });

  it("rewrites only the misspelled words of a query", () => {
    expect(didYouMean("duitse stahlhem", vocab)).toBe("duitse stahlhelm");
    expect(didYouMean("helm onder 500", vocab)).toBeNull();
    expect(didYouMean("“stahlhem”", vocab)).toBe("“stahlhelm”");
  });
});
