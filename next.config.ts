import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Loaded at runtime from node_modules instead of being bundled (native/large server deps).
  serverExternalPackages: ["pg-boss", "sharp"],
  experimental: {
    // Image uploads go through server actions; images may be up to 25 MB (src/server/media/images.ts).
    serverActions: { bodySizeLimit: "26mb" },
    // src/proxy.ts runs on /admin/**; request bodies above this are truncated when a proxy runs.
    proxyClientMaxBodySize: "26mb",
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
