import { describe, expect, it } from "vitest";
import { bandFor, CLOSE, MARGIN, MAX_CANDIDATES, selectCandidates, VERY_CLOSE, type DuplicateHit } from "./bands";

const T = "tenant-a";
const hit = (productId: string, score: number, o: Partial<DuplicateHit> = {}): DuplicateHit => ({ productId, tenantId: T, status: "ACTIVE", score, ...o });

describe("bandFor", () => {
  it("bands by the calibrated thresholds", () => {
    expect(VERY_CLOSE).toBeGreaterThan(CLOSE);
    expect(bandFor(1)).toBe("very_close");
    expect(bandFor(VERY_CLOSE)).toBe("very_close");
    expect(bandFor(VERY_CLOSE - 0.0001)).toBe("close");
    expect(bandFor(CLOSE)).toBe("close");
    expect(bandFor(CLOSE - 0.0001)).toBeNull();
    expect(bandFor(0.5)).toBeNull();
    expect(bandFor(Number.NaN)).toBeNull();
  });

  it("matches the calibration: the same photo is very close, a typical look-alike is not shown", () => {
    expect(bandFor(0.988)).toBe("very_close"); // lowest re-upload of the same photo (demo)
    expect(bandFor(0.977)).toBe("close"); // median: another photo of the same product
    expect(bandFor(0.955)).toBeNull(); // median: best other product in the same category
  });
});

describe("selectCandidates", () => {
  it("excludes the product being edited", () => {
    const out = selectCandidates([hit("self", 0.999), hit("other", 0.99)], { tenantId: T, excludeProductId: "self" });
    expect(out.map((c) => c.productId)).toEqual(["other"]);
  });

  it("drops hits of other tenants (tenant isolation)", () => {
    const out = selectCandidates([hit("foreign", 0.999, { tenantId: "tenant-b" }), hit("own", 0.99)], { tenantId: T });
    expect(out.map((c) => c.productId)).toEqual(["own"]);
  });

  it("includes drafts, sold and other statuses", () => {
    const out = selectCandidates([hit("draft", 0.99, { status: "DRAFT" }), hit("sold", 0.992, { status: "SOLD" }), hit("stock", 0.988, { status: "ACTIVE" })], { tenantId: T });
    expect(out.map((c) => [c.productId, c.status])).toEqual([
      ["sold", "SOLD"],
      ["draft", "DRAFT"],
      ["stock", "ACTIVE"],
    ]);
  });

  it("keeps the best score per product over several uploaded photos", () => {
    const out = selectCandidates([hit("a", 0.972), hit("a", 0.99), hit("b", 0.98)], { tenantId: T });
    expect(out).toEqual([
      { productId: "a", status: "ACTIVE", score: 0.99, band: "very_close" },
      { productId: "b", status: "ACTIVE", score: 0.98, band: "close" },
    ]);
  });

  it("drops scores below close and the tail beyond the margin", () => {
    const out = selectCandidates([hit("a", 0.995), hit("b", 0.995 - MARGIN + 0.001), hit("c", 0.975), hit("d", 0.9)], { tenantId: T });
    expect(out.map((c) => c.productId)).toEqual(["a", "b"]);
  });

  it("returns at most three, ordered by score", () => {
    const out = selectCandidates([hit("a", 0.99), hit("b", 0.995), hit("c", 0.992), hit("d", 0.991)], { tenantId: T });
    expect(out).toHaveLength(MAX_CANDIDATES);
    expect(out.map((c) => c.productId)).toEqual(["b", "c", "d"]);
  });

  it("returns nothing for no hits", () => {
    expect(selectCandidates([], { tenantId: T })).toEqual([]);
  });
});
