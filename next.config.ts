import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { htmlLimitedBotsPattern } from "./src/lib/seo/bots";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Loaded at runtime from node_modules instead of being bundled (native/large server deps).
  serverExternalPackages: ["pg-boss", "sharp", "@react-pdf/renderer"],
  // Read with fs at runtime (src/server/geo/ip-country.ts), so the tracer can't see it: ship it explicitly.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@ip-location-db/geo-whois-asn-country-mmdb/geo-whois-asn-country.mmdb"],
  },
  // AI answer engines (GPTBot, ClaudeBot, PerplexityBot …) mostly read raw HTML: give them blocking
  // metadata in <head> like Next does for classic crawlers (Next's default list + AI bots; src/lib/seo/bots.ts).
  htmlLimitedBots: htmlLimitedBotsPattern(HTML_LIMITED_BOT_UA_RE.source),
  // Response compression (docs/perf/round2.md § Compressie). Default on: plain `next start` and the
  // docker-compose setup have nothing in front of them. Images for an ingress that compresses (brotli,
  // deploy/k8s/ingress-nginx/values.yaml) are built with NEXT_COMPRESS=false (Dockerfile build-arg) —
  // the value is baked into the standalone server at build time.
  compress: process.env.NEXT_COMPRESS !== "false",
  async headers() {
    return [
      // Self-hosted fonts (/fonts/shop, /fonts/admin): content-hashed file names (scripts/fonts/sync-fonts.ts) → cache forever.
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  experimental: {
    // Image uploads go through server actions; images may be up to 25 MB (src/server/media/images.ts).
    serverActions: { bodySizeLimit: "26mb" },
    // src/proxy.ts runs on /admin/**; request bodies above this are truncated when a proxy runs.
    proxyClientMaxBodySize: "26mb",
    // CSS in <style> instead of render-blocking <link> (docs/perf/round2.md § CSS): saves the CSS round
    // trip on every full page load (mobile, applied 4G throttling: FCP 1.54 → 0.83 s, LCP 1.54 → 0.8–1.3 s).
    // Cost: +~13–17 kB gzip per HTML document (Next also repeats the CSS in the RSC payload) and no
    // separate CSS caching; client-side navigations are unaffected. Production builds only.
    inlineCss: true,
    // Client router cache (docs/perf/round2.md § Navigatie). `dynamic` stays 0: shop pages show live
    // availability/cart state and many server actions do not revalidate, so revisits always refetch
    // (back/forward is served from the bfcache regardless). `static` (full prefetches — product links
    // prefetch the whole page on hover/touch via `unstable_dynamicOnHover`) is lowered from 5 min to
    // the 30 s minimum so a hovered-but-not-clicked product is never shown more than 30 s old.
    staleTimes: { dynamic: 0, static: 30 },
  },
  // Storefront CMS pages are linked as `/{slug}` (src/server/content/rules.ts contentPageHref) but live
  // at src/app/(shop)/pages/[slug]. A *fallback* rewrite only applies when no page or dynamic route
  // matched, so it can never shadow app routes (/shop, /cart, /admin …).
  // Caching decision: `cacheComponents` stays OFF (it would force every request-time read in the admin
  // behind Suspense). Shop reads use `unstable_cache` with per-tenant tags — src/server/storefront/cache.ts.
  async rewrites() {
    return {
      // Markdown alternates for AI assistants (docs/seo-geo.md): /product/123.md and /{cms-slug}.md.
      beforeFiles: [
        { source: "/product/:code(\\d{1,9}).md", destination: "/md/product/:code" },
        { source: "/:slug([a-z0-9]+(?:-[a-z0-9]+)*).md", destination: "/md/page/:slug" },
      ],
      afterFiles: [],
      fallback: [
        { source: "/:slug([a-z0-9]+(?:-[a-z0-9]+)*)", destination: "/pages/:slug" },
        // Anything else nothing matched: look up a redirect (old Concept500 URLs, owner-managed) or
        // render the shop 404 — src/app/(shop)/qm-unmatched, src/server/redirects/runtime.ts.
        { source: "/:path+", destination: "/qm-unmatched/:path+" },
      ],
    };
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
