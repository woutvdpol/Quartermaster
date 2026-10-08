/*
 * Sitemap XML (sitemaps.org 0.9 + Google image extension). Pure. Next's `sitemap.ts` convention
 * cannot produce a sitemap index, so the shop serves these from route handlers:
 *   /sitemap.xml               index (src/app/sitemap.xml/route.ts)
 *   /sitemaps/{name}.xml       one file per kind, products split in chunks (src/app/sitemaps/[file])
 *
 * Google ignores <priority> and <changefreq>; only <lastmod> is used (when it is accurate), so
 * that is all we emit. Image entries carry only <image:loc> (title/caption were deprecated in 2022).
 */

export type SitemapUrl = { loc: string; lastmod?: string | Date | null; images?: string[] };
export type SitemapRef = { loc: string; lastmod?: string | Date | null };

/** Max URLs per product sitemap file (protocol limit is 50,000 / 50 MB; images make entries big). */
export const PRODUCTS_PER_SITEMAP = 10_000;
/** Google accepts up to 1,000 images per URL; a product page shows far fewer. */
export const IMAGES_PER_URL = 10;

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** W3C datetime (ISO 8601, UTC) or null when unparsable. */
export function w3cDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function sitemapIndexXml(refs: SitemapRef[]): string {
  const body = refs
    .map((r) => {
      const lastmod = w3cDate(r.lastmod);
      return `<sitemap><loc>${xmlEscape(r.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</sitemap>`;
    })
    .join("\n");
  return `${HEAD}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function urlsetXml(urls: SitemapUrl[]): string {
  const withImages = urls.some((u) => u.images?.length);
  const body = urls
    .map((u) => {
      const lastmod = w3cDate(u.lastmod);
      const images = (u.images ?? [])
        .slice(0, IMAGES_PER_URL)
        .map((src) => `<image:image><image:loc>${xmlEscape(src)}</image:loc></image:image>`)
        .join("");
      return `<url><loc>${xmlEscape(u.loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${images}</url>`;
    })
    .join("\n");
  const ns = `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${withImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ""}`;
  return `${HEAD}<urlset ${ns}>\n${body}${body ? "\n" : ""}</urlset>\n`;
}

/** Latest of a list of dates (ISO), or null. */
export function latest(dates: (string | Date | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const d of dates) {
    const iso = w3cDate(d);
    if (!iso) continue;
    const t = Date.parse(iso);
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Sitemap file names: "pages", "categories", "facets", "products-1" … */
export type SitemapFile = { kind: "pages" | "categories" | "facets" } | { kind: "products"; chunk: number };

export function parseSitemapFile(name: string): SitemapFile | null {
  const m = /^(pages|categories|facets|products-(\d{1,4}))\.xml$/.exec(name);
  if (!m) return null;
  if (m[2]) {
    const chunk = Number(m[2]);
    return chunk >= 1 ? { kind: "products", chunk } : null;
  }
  return { kind: m[1] as "pages" | "categories" | "facets" };
}

export function sitemapFileName(f: SitemapFile): string {
  return f.kind === "products" ? `products-${f.chunk}.xml` : `${f.kind}.xml`;
}
