import { describe, expect, it } from "vitest";
import { acceptsMachineResult, needsReview, normalizeSource, planSync, sourceHash } from "./state";

const h = (s: string) => sourceHash(s);

describe("planSync", () => {
  it("creates a QUEUED row for new source text", () => {
    expect(planSync(null, "Helmet")).toEqual({ kind: "create", sourceHash: h("Helmet") });
  });

  it("does nothing without source text and deletes an existing row when the text is emptied", () => {
    expect(planSync(null, null)).toEqual({ kind: "none" });
    expect(planSync({ status: "MACHINE", sourceHash: h("x"), stale: false }, null)).toEqual({ kind: "delete" });
    expect(planSync({ status: "APPROVED", sourceHash: h("x"), stale: false }, null)).toEqual({ kind: "delete" });
  });

  it("leaves unchanged rows alone", () => {
    for (const status of ["QUEUED", "MACHINE", "APPROVED"] as const) {
      expect(planSync({ status, sourceHash: h("Helmet"), stale: false }, "Helmet")).toEqual({ kind: "none" });
    }
  });

  it("re-queues unreviewed rows when the English text changes", () => {
    expect(planSync({ status: "MACHINE", sourceHash: h("old"), stale: false }, "new")).toEqual({ kind: "requeue", sourceHash: h("new") });
    expect(planSync({ status: "QUEUED", sourceHash: h("old"), stale: false }, "new")).toEqual({ kind: "requeue", sourceHash: h("new") });
  });

  it("keeps approved translations online but flags them stale, and un-flags on revert", () => {
    expect(planSync({ status: "APPROVED", sourceHash: h("old"), stale: false }, "new")).toEqual({ kind: "stale", stale: true });
    expect(planSync({ status: "APPROVED", sourceHash: h("old"), stale: true }, "newer")).toEqual({ kind: "none" });
    expect(planSync({ status: "APPROVED", sourceHash: h("old"), stale: true }, "old")).toEqual({ kind: "stale", stale: false });
  });
});

describe("helpers", () => {
  it("normalizeSource trims, unifies newlines, maps empty to null", () => {
    expect(normalizeSource("  a\r\nb  ")).toBe("a\nb");
    expect(normalizeSource("   ")).toBeNull();
    expect(normalizeSource(null)).toBeNull();
  });

  it("needsReview: machine proposals and stale approvals", () => {
    expect(needsReview({ status: "MACHINE", stale: false })).toBe(true);
    expect(needsReview({ status: "APPROVED", stale: true })).toBe(true);
    expect(needsReview({ status: "APPROVED", stale: false })).toBe(false);
    expect(needsReview({ status: "QUEUED", stale: false })).toBe(false);
  });

  it("acceptsMachineResult only for the same queued source", () => {
    expect(acceptsMachineResult({ status: "QUEUED", sourceHash: h("a"), stale: false }, h("a"))).toBe(true);
    expect(acceptsMachineResult({ status: "QUEUED", sourceHash: h("b"), stale: false }, h("a"))).toBe(false);
    expect(acceptsMachineResult({ status: "APPROVED", sourceHash: h("a"), stale: false }, h("a"))).toBe(false);
  });
});
