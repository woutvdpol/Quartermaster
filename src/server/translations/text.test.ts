import { describe, expect, it } from "vitest";
import { chunkLong, collapseRepeats, prepareText, splitSentences, tidyEmphasis } from "./text";

/** Upper-cases the words (stand-in "translation") but keeps placeholders exactly. */
const shout = (units: readonly string[]) => units.map((u) => u.replace(/\b(?!QZ\d)([A-Za-z]+)\b/g, (w) => w.toUpperCase()));

describe("splitSentences", () => {
  it("splits on sentence ends and keeps the separators", () => {
    const { sentences, separators } = splitSentences("Original helmet. Paint is 80% present!  Liner complete? Yes.");
    expect(sentences).toEqual(["Original helmet.", "Paint is 80% present!", "Liner complete?", "Yes."]);
    expect(separators).toEqual([" ", "  ", " "]);
  });

  it("does not split after abbreviations, initials and short ordinals", () => {
    expect(splitSentences("Stock No. 50160 from ca. 1943 by J. Smith. Used in the 2. Weltkrieg by the 1. Kompanie.").sentences).toEqual([
      "Stock No. 50160 from ca. 1943 by J. Smith.",
      "Used in the 2. Weltkrieg by the 1. Kompanie.",
    ]);
  });

  it("does not split URLs or decimals", () => {
    expect(splitSentences("See www.example.org/a.b for 1.5 cm details.").sentences).toHaveLength(1);
  });
});

describe("chunkLong", () => {
  it("cuts long sentences at commas near the middle and keeps every character", () => {
    const s = `${"word ".repeat(60).trim()}, ${"more ".repeat(60).trim()}.`;
    const { pieces, separators } = chunkLong(s, 200);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 200)).toBe(true);
    expect(pieces.reduce((acc, p, i) => acc + (i ? separators[i - 1] : "") + p, "")).toBe(s);
  });
});

describe("prepareText", () => {
  it("plain fields: one unit per sentence, codes protected, layout restored", () => {
    const p = prepareText("Stahlhelm M40 Heer, ET64", { markdown: false, terms: [{ source: "Heer", target: null }] });
    expect(p.units).toEqual(["Stahlhelm QZ0 QZ1, QZ2"]);
    expect(p.assemble(["Stahlhelm QZ0 QZ1, QZ2"]).text).toBe("Stahlhelm M40 Heer, ET64");
  });

  it("skips text with nothing to translate (only codes, numbers, URLs)", () => {
    const p = prepareText("ET64 / 3721 — https://example.org/x", { markdown: false });
    expect(p.units).toEqual([]);
    expect(p.assemble([]).text).toBe("ET64 / 3721 — https://example.org/x");
  });

  it("Markdown: keeps headings, lists, quotes, rules, code fences, tables and blank lines", () => {
    const md = [
      "## Condition",
      "",
      "Very good. Paint 80% present.",
      "",
      "- Maker ET64, lot 3721",
      "- [x] Liner complete",
      "1. First owner",
      "> Found in an attic.",
      "",
      "---",
      "```",
      "do not translate this",
      "```",
      "| Part | State |",
      "|---|:--:|",
      "| shell | good |",
      "Line with hard break  ",
      "next line",
    ].join("\n");
    const p = prepareText(md, { markdown: true });
    expect(p.units).toEqual([
      "Condition",
      "Very good.",
      "Paint QZ0% present.",
      "Maker QZ0, lot QZ1",
      "Liner complete",
      "First owner",
      "Found in an attic.",
      "Part",
      "State",
      "shell",
      "good",
      "Line with hard break",
      "next line",
    ]);
    const out = p.assemble(shout(p.units)).text;
    expect(out).toBe(
      [
        "## CONDITION",
        "",
        "VERY GOOD. PAINT 80% PRESENT.",
        "",
        "- MAKER ET64, LOT 3721",
        "- [x] LINER COMPLETE",
        "1. FIRST OWNER",
        "> FOUND IN AN ATTIC.",
        "",
        "---",
        "```",
        "do not translate this",
        "```",
        "| PART | STATE |",
        "|---|:--:|",
        "| SHELL | GOOD |",
        "LINE WITH HARD BREAK  ",
        "NEXT LINE",
      ].join("\n"),
    );
  });

  it("Markdown: link targets and images survive, emphasis spacing from the model is tidied", () => {
    const p = prepareText("The helmet is **very rare**, see [this one](/product/12) and ![photo](/uploads/a.jpg).", { markdown: true });
    expect(p.units).toEqual(["The helmet is **very rare**, see [this one](QZ0) and QZ1."]);
    const out = p.assemble(["De helm is ** zeer zeldzaam**, zie [deze](QZ0) en QZ1."]).text;
    expect(out).toBe("De helm is **zeer zeldzaam**, zie [deze](/product/12) en ![photo](/uploads/a.jpg).");
  });

  it("reports placeholders the model dropped", () => {
    const p = prepareText("Maker ET64 helmet.", { markdown: false });
    expect(p.assemble(["Helm van de maker."]).missing).toBe(1);
  });

  it("rejects a result of the wrong length", () => {
    const p = prepareText("One. Two.", { markdown: false });
    expect(() => p.assemble(["Een."])).toThrow();
  });
});

describe("tidyEmphasis", () => {
  it("only collapses whitespace inside emphasis pairs", () => {
    expect(tidyEmphasis("a ** b ** c and **d**")).toBe("a **b** c and **d**");
    expect(tidyEmphasis("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

describe("collapseRepeats", () => {
  it("collapses punctuation loops from the model but keeps an ellipsis", () => {
    expect(collapseRepeats("Kleidung............")).toBe("Kleidung.");
    expect(collapseRepeats("beschrieben.???????? Bitte")).toBe("beschrieben. Bitte");
    expect(collapseRepeats("Wait... really")).toBe("Wait... really");
  });
});
