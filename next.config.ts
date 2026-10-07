import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Loaded at runtime from node_modules instead of being bundled (native/large server deps).
  serverExternalPackages: ["pg-boss", "sharp", "@react-pdf/renderer"],
  experimental: {
    // Image uploads go through server actions; images may be up to 25 MB (src/server/media/images.ts).
    serverActions: { bodySizeLimit: "26mb" },
    // src/proxy.ts runs on /admin/**; request bodies above this are truncated when a proxy runs.
    proxyClientMaxBodySize: "26mb",
  },
  // Storefront CMS pages are linked as `/{slug}` (src/server/content/rules.ts contentPageHref) but live
  // at src/app/(shop)/pages/[slug]. A *fallback* rewrite only applies when no page or dynamic route
  // matched, so it can never shadow app routes (/shop, /cart, /admin …).
  // Caching decision: `cacheComponents` stays OFF (it would force every request-time read in the admin
  // behind Suspense). Shop reads use `unstable_cache` with per-tenant tags — src/server/storefront/cache.ts.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/:slug([a-z0-9]+(?:-[a-z0-9]+)*)", destination: "/pages/:slug" }],
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
