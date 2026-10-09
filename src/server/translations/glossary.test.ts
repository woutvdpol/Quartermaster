import { describe, expect, it } from "vitest";
import { normalizeTerms, protect, restore } from "./glossary";

/** Simulates a model that copies placeholders but changes the words around them. */
const fakeTranslate = (s: string) => s.replace(/\bhelmet\b/g, "helm").replace(/\bwith\b/g, "met");

describe("protect / restore", () => {
  it("keeps maker codes, lot numbers, sizes and stock numbers", () => {
    const p = protect("Original M40 steel helmet, maker-marked ET64 with lot number 3721, size 57, No. 50160.");
    expect(p.text).not.toMatch(/ET64|3721|M40|50160|\b57\b/);
    expect(p.tokens).toEqual(["M40", "ET64", "3721", "57", "50160"]);
    expect(restore(fakeTranslate(p.text), p.tokens).text).toBe("Original M40 steel helm, maker-marked ET64 met lot number 3721, size 57, No. 50160.");
  });

  it("keeps compound codes and acronyms whole", () => {
    const p = protect("Badge 1./IR 9 by RZM, dated 1943-45, WW2 era, DRGM marked.");
    expect(p.tokens).toEqual(["1./IR", "9", "RZM", "1943-45", "WW2", "DRGM"]);
  });

  it("protects URLs, e-mail, inline code and Markdown link targets but leaves link labels translatable", () => {
    const p = protect("See [the other helmet](https://shop.example/product/12) or mail info@shop.example, code `ABC`, www.example.org.");
    expect(p.text).toContain("[the other helmet](QZ0)");
    expect(p.tokens).toEqual(["https://shop.example/product/12", "`ABC`", "info@shop.example", "www.example.org"].sort((a, b) => p.tokens.indexOf(a) - p.tokens.indexOf(b)));
    expect(restore(p.text, p.tokens).text).toBe("See [the other helmet](https://shop.example/product/12) or mail info@shop.example, code `ABC`, www.example.org.");
  });

  it("applies glossary mappings case-insensitively on whole words only", () => {
    const terms = normalizeTerms([
      { source: "liner", target: "Innenfutter" },
      { source: "decal", target: "Abzeichen" },
    ]);
    const p = protect("Leather Liner complete; the decal is 80% present. Linerless shells excluded.", terms);
    const r = restore(p.text, p.tokens).text;
    expect(r).toBe("Leather Innenfutter complete; the Abzeichen is 80% present. Linerless shells excluded.");
  });

  it("keeps 'never translate' terms as written, also multi-word, longest first", () => {
    const terms = normalizeTerms([
      { source: "Heer", target: null },
      { source: "Waffen-SS", target: null },
      { source: "maker  marked", target: "Herstellerkennung" },
    ]);
    const p = protect("Single HEER decal, Waffen-SS style, maker marked inside.", terms);
    expect(p.tokens).toEqual(["HEER", "Waffen-SS", "Herstellerkennung"]);
    expect(p.text).toBe("Single QZ0 decal, QZ1 style, QZ2 inside.");
  });

  it("matches accented terms with Unicode word boundaries", () => {
    const terms = normalizeTerms([{ source: "Fallschirmjäger", target: null }]);
    const p = protect("A Fallschirmjäger helmet; not Fallschirmjägerhelm.", terms);
    expect(p.tokens).toEqual(["Fallschirmjäger"]);
  });

  it("does not confuse a source text that itself contains QZ<n>", () => {
    const p = protect("Model QZ1 rifle sling");
    expect(p.tokens).toEqual(["QZ1"]);
    expect(restore("Modell QZ0 Gewehrriemen", p.tokens).text).toBe("Modell QZ1 Gewehrriemen");
  });

  it("counts placeholders the model dropped and leaves unknown ones alone", () => {
    expect(restore("Helm QZ0 und QZ7", ["ET64", "3721"])).toEqual({ text: "Helm ET64 und QZ7", missing: 1 });
  });

  it("normalises the glossary: trims, dedupes case-insensitively, empty target = keep", () => {
    expect(
      normalizeTerms([
        { source: " shell ", target: "Glocke" },
        { source: "Shell", target: "Helmglocke" },
        { source: "Heer", target: "  " },
        { source: " ", target: "x" },
      ]),
    ).toEqual([
      { source: "Shell", target: "Helmglocke" },
      { source: "Heer", target: null },
    ]);
  });
});
