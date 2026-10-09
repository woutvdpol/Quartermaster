import { describe, expect, it } from "vitest";
import { nachLand } from "./de-grammar";

describe("nachLand", () => {
  it("uses 'nach' for countries without an article and 'in' + article otherwise", () => {
    expect(nachLand("Deutschland")).toBe("nach Deutschland");
    expect(nachLand("Niederlande")).toBe("in die Niederlande");
    expect(nachLand("Schweiz")).toBe("in die Schweiz");
    expect(nachLand("Vereinigtes Königreich")).toBe("ins Vereinigte Königreich");
  });
});
