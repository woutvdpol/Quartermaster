/*
 * Fetches key pages of a running shop and checks their JSON-LD (parse + required fields,
 * src/lib/seo/validate.ts). Usage:
 *
 *   npx tsx scripts/seo/validate-jsonld.ts [http://concept.localhost:3000]
 *
 * Pages: home, /shop, the first category and the first product found in the catalog. Requests use
 * an AI-crawler user agent so metadata is rendered blocking in <head> (next.config.ts htmlLimitedBots).
 */
import { extractJsonLd, validateJsonLd } from "../../src/lib/seo/validate";

const base = process.argv[2] ?? "http://concept.localhost:3000";
const UA = "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";

async function get(path: string): Promise<string> {
  const res = await fetch(new URL(path, base), { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const shop = await get("/shop");
  const category = shop.match(/href="(\/shop\/category\/[^"?]+)"/)?.[1];
  const product = shop.match(/href="(\/product\/\d+\/[^"?]+)"/)?.[1];
  const pages = ["/", "/shop", ...(category ? [category] : []), ...(product ? [product] : [])];
  let failed = 0;
  for (const path of pages) {
    const html = path === "/shop" ? shop : await get(path);
    const nodes = extractJsonLd(html);
    const errors = nodes.flatMap(validateJsonLd);
    const head = html.slice(0, html.indexOf("</head>"));
    const canonical = head.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "(none in <head>)";
    console.log(`${errors.length ? "✗" : "✓"} ${path}  [${nodes.map((n) => n["@type"]).join(", ")}]  canonical=${canonical}`);
    for (const e of errors) console.log(`    ${e}`);
    failed += errors.length;
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
