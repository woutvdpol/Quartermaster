import "server-only";
import { ImageResponse } from "next/og";
import { truncate } from "@/lib/seo/text";

/*
 * Generated 1200×630 Open Graph card (shop name + title) for pages without a photo: products without
 * images and shops without a banner. Satori/Resvg with Next's bundled default font; no remote assets.
 */
export function ogCard(input: { shopName: string; title: string; eyebrow?: string | null; color: string }): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#fbfaf7", color: "#1d1d1b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 22, height: 22, borderRadius: 999, background: input.color }} />
          <div style={{ fontSize: 34, fontWeight: 700 }}>{truncate(input.shopName, 48)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {input.eyebrow ? <div style={{ fontSize: 30, color: "#6b6a64" }}>{truncate(input.eyebrow, 70)}</div> : null}
          <div style={{ fontSize: 64, lineHeight: 1.08, fontWeight: 700, letterSpacing: -1.5 }}>{truncate(input.title, 110)}</div>
        </div>
        <div style={{ height: 10, width: 160, background: input.color, borderRadius: 999 }} />
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
