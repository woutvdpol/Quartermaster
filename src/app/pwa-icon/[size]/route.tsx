import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getShopContext } from "@/server/storefront/context";
import { getStorage, isValidKey } from "@/server/media/storage";

/*
 * Square PNG app icons of a shop (web app manifest, apple-touch-icon, push notification icon;
 * docs/push.md). The shop logo centred on a light tile; without a logo a monogram in the theme colour.
 *   /pwa-icon/180 (iOS home screen), /pwa-icon/192, /pwa-icon/512, /pwa-icon/maskable (512, safe zone)
 */

const SIZES: Record<string, { px: number; pad: number }> = {
  "180": { px: 180, pad: 0.1 },
  "192": { px: 192, pad: 0.1 },
  "512": { px: 512, pad: 0.1 },
  maskable: { px: 512, pad: 0.22 }, // Android crops maskable icons to a circle: keep the logo in the inner 60 %
};

const TILE = "#fffdf8";
const HEADERS = { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600, s-maxage=86400" };

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function logoBytes(logoPath: string | null, tenantId: string): Promise<Uint8Array | null> {
  if (!logoPath?.startsWith("/uploads/")) return null;
  const key = logoPath.slice("/uploads/".length);
  if (!isValidKey(key) || !key.startsWith(`${tenantId}/`)) return null;
  const obj = await getStorage().get(key);
  return obj ? new Uint8Array(await new Response(obj.body).arrayBuffer()) : null;
}

export async function GET(_request: Request, ctx: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await ctx.params).size];
  if (!spec) return notFound();
  const shop = await getShopContext();
  if (!shop) return notFound();
  const { appearance } = shop.settings;

  try {
    const logo = await logoBytes(appearance.logoPath, shop.tenant.id);
    if (logo) {
      const inner = Math.round(spec.px * (1 - 2 * spec.pad));
      const fitted = await sharp(logo).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const png = await sharp({ create: { width: spec.px, height: spec.px, channels: 4, background: TILE } })
        .composite([{ input: fitted, gravity: "center" }])
        .png()
        .toBuffer();
      return new Response(new Uint8Array(png), { headers: HEADERS });
    }
  } catch (err) {
    console.error("[pwa-icon] logo render failed", err);
  }

  const letter = (shop.shopName.trim()[0] ?? "Q").toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: appearance.colors.primary, color: "#ffffff", fontSize: spec.px * (spec.pad > 0.2 ? 0.4 : 0.55), fontWeight: 700 }}>
        {letter}
      </div>
    ),
    { width: spec.px, height: spec.px, headers: { "Cache-Control": HEADERS["Cache-Control"] } },
  );
}
