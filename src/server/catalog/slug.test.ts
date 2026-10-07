import { describe, expect, it } from "vitest";
import { MAX_SLUG_LENGTH, nextFreeSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lower-cases and joins words with dashes", () => {
    expect(slugify("  M43 Field Cap — Wehrmacht  ")).toBe("m43-field-cap-wehrmacht");
  });
  it("strips diacritics and handles German/Nordic letters", () => {
    expect(slugify("Überjäger Mütze")).toBe("uberjager-mutze");
    expect(slugify("Straße & Søn")).toBe("strasse-and-son");
  });
  it("collapses punctuation and trims dashes", () => {
    expect(slugify("--Helmet (M35) / DD!!--")).toBe("helmet-m35-dd");
  });
  it("returns empty string when nothing is usable", () => {
    expect(slugify("†††")).toBe("");
  });
  it("cuts long titles at a word boundary", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(s.endsWith("-")).toBe(false);
    expect(s.endsWith("word")).toBe(true);
  });
});

describe("nextFreeSlug", () => {
  it("returns the base when free", () => {
    expect(nextFreeSlug("cap", ["cap-2"])).toBe("cap");
  });
  it("appends -2, -3 … for taken slugs", () => {
    expect(nextFreeSlug("cap", ["cap"])).toBe("cap-2");
    expect(nextFreeSlug("cap", ["cap", "cap-2", "cap-3"])).toBe("cap-4");
    expect(nextFreeSlug("cap", ["cap", "cap-3"])).toBe("cap-2");
  });
});
