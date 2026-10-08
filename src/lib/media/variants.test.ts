import { describe, expect, it } from "vitest";
import { pickSources, sourcesFromManifest, srcSets } from "./variants";

const entry = (name: string, width: number, avif = true) => ({
  key: `t/products/p/i/${name}.webp`,
  width,
  ...(avif ? { avif: { key: `t/products/p/i/${name}.avif` } } : {}),
});

describe("responsive variants", () => {
  it("builds ascending, de-duplicated sources from a manifest", () => {
    const sources = sourcesFromManifest({
      large: entry("large", 500),
      card: entry("card", 500),
      thumb: entry("thumb", 320),
      w480: entry("w480", 480),
      blur: { key: "t/products/p/i/blur.webp", width: 24 },
    });
    expect(sources?.map((s) => s.w)).toEqual([320, 480, 500]);
    expect(sources?.[2]).toEqual({ w: 500, webp: "/uploads/t/products/p/i/card.webp", avif: "/uploads/t/products/p/i/card.avif" });
  });

  it("keeps pre-round-3 manifests working (WebP only, no AVIF)", () => {
    const sources = sourcesFromManifest({ thumb: entry("thumb", 320, false), card: entry("card", 800, false), large: entry("large", 2000, false) })!;
    expect(srcSets(pickSources(sources, "card"))).toEqual({
      webp: "/uploads/t/products/p/i/thumb.webp 320w, /uploads/t/products/p/i/card.webp 800w",
      avif: null,
    });
    expect(sourcesFromManifest({})).toBeNull();
    expect(sourcesFromManifest(null)).toBeNull();
  });

  it("limits widths per profile and never returns an empty set", () => {
    const all = sourcesFromManifest(
      Object.fromEntries((["thumb", "w480", "w640", "card", "w1080", "w1440", "large"] as const).map((n, i) => [n, entry(n, [320, 480, 640, 800, 1080, 1440, 2000][i])])),
    )!;
    expect(pickSources(all, "card").map((s) => s.w)).toEqual([320, 480, 640, 800]);
    expect(pickSources(all, "wide").map((s) => s.w)).toEqual([480, 640, 800, 1080, 1440, 2000]);
    expect(pickSources([{ w: 300, webp: "/a.webp" }], "wide")).toEqual([{ w: 300, webp: "/a.webp" }]);
    const sets = srcSets(pickSources(all, "card"));
    expect(sets.avif).toBe(
      "/uploads/t/products/p/i/thumb.avif 320w, /uploads/t/products/p/i/w480.avif 480w, /uploads/t/products/p/i/w640.avif 640w, /uploads/t/products/p/i/card.avif 800w",
    );
  });
});
