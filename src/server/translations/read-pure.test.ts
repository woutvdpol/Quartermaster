import { describe, expect, it } from "vitest";
import { hasTranslation, normalizeIds, toTranslationValues, translatedText, translationsTag } from "./read-pure";

describe("translation read side (pure)", () => {
  const values = toTranslationValues([
    { entityId: "p1", field: "title", value: "Stahlhelm M40" },
    { entityId: "p1", field: "description", value: "  " },
    { entityId: "p2", field: "title", value: null },
  ]);

  it("keeps only non-empty values", () => {
    expect(values).toEqual({ p1: { title: "Stahlhelm M40" } });
  });

  it("falls back to the English source when nothing is approved", () => {
    expect(translatedText(values, "p1", "title", "Steel helmet M40")).toBe("Stahlhelm M40");
    expect(translatedText(values, "p1", "description", "English text")).toBe("English text");
    expect(translatedText(values, "p2", "title", "Tunic")).toBe("Tunic");
    expect(translatedText(values, "p3", "title", null)).toBeNull();
    expect(hasTranslation(values, "p1", "title")).toBe(true);
    expect(hasTranslation(values, "p1", "description")).toBe(false);
  });

  it("builds stable tags and cache keys", () => {
    expect(translationsTag("t1")).toBe("tenant:t1:translations");
    expect(translationsTag("t1", "de")).toBe("tenant:t1:translations:de");
    expect(normalizeIds(["b", "a", "b", ""])).toEqual(["a", "b"]);
  });
});
