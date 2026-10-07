import { describe, expect, it } from "vitest";
import { IDENTITY, MAX_SCALE, clampPan, panBy, zoomAt } from "./zoom";

const box = { width: 400, height: 300 };

describe("zoom math", () => {
  it("keeps the point under the cursor fixed", () => {
    const p = { x: 100, y: 50 };
    const z = zoomAt(IDENTITY, 2, p, box);
    // content point under p before: p (identity). After: (p - t) / s must equal p.
    expect((p.x - z.x) / z.scale).toBeCloseTo(p.x);
    expect((p.y - z.y) / z.scale).toBeCloseTo(p.y);
  });

  it("clamps scale and resets at 1", () => {
    expect(zoomAt(IDENTITY, 100, { x: 0, y: 0 }, box).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 3, x: 50, y: 50 }, 0.5, { x: 0, y: 0 }, box)).toEqual(IDENTITY);
  });

  it("limits panning to the scaled content", () => {
    expect(clampPan({ scale: 2, x: 1000, y: -1000 }, box)).toEqual({ scale: 2, x: 200, y: -150 });
    expect(panBy(IDENTITY, 50, 50, box)).toEqual(IDENTITY);
  });
});
