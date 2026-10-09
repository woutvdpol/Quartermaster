import { describe, expect, it } from "vitest";
import { dealerProductUrl, dealerShopUrl, networkHref, networkMount, networkRewritePath, platformApplyUrl, platformNetworkRedirect } from "./network";

const platformOnly = { platformHost: "platform.example", networkHost: null };
const withNetwork = { platformHost: "platform.example", networkHost: "network.example" };

describe("networkMount", () => {
  it("serves /network on the platform host without NETWORK_HOST", () => {
    expect(networkMount("Platform.Example", platformOnly)).toEqual({ kind: "serve", base: "/network", origin: "https://platform.example" });
  });
  it("serves / on NETWORK_HOST and redirects the platform host there", () => {
    expect(networkMount("network.example", withNetwork)).toEqual({ kind: "serve", base: "", origin: "https://network.example" });
    expect(networkMount("platform.example", withNetwork)).toEqual({ kind: "redirect", origin: "https://network.example" });
  });
  it("never serves on shop or unknown hosts", () => {
    expect(networkMount("shop.example", withNetwork)).toEqual({ kind: "none" });
    expect(networkMount(null, platformOnly)).toEqual({ kind: "none" });
    expect(networkMount("platform.example", { platformHost: null, networkHost: null })).toEqual({ kind: "none" });
  });
});

describe("links", () => {
  it("prefixes network links with the mount base", () => {
    expect(networkHref("/network")).toBe("/network");
    expect(networkHref("/network", "/dealers")).toBe("/network/dealers");
    expect(networkHref("")).toBe("/");
    expect(networkHref("", "dealers")).toBe("/dealers");
  });
  it("builds absolute dealer URLs on the primary domain (http only for local dev hosts)", () => {
    expect(dealerProductUrl("shop.example", { stockCode: 50160, slug: "stahlhelm-m40" })).toBe("https://shop.example/product/50160/stahlhelm-m40");
    expect(dealerProductUrl("concept.localhost:3000", { stockCode: 7, slug: "a b" })).toBe("http://concept.localhost:3000/product/7/a%20b");
    expect(dealerShopUrl("shop.example")).toBe("https://shop.example/");
  });
  it("links the dealer application on the platform host", () => {
    expect(platformApplyUrl("/network", withNetwork)).toBe("/apply");
    expect(platformApplyUrl("", withNetwork)).toBe("https://platform.example/apply");
  });
});

describe("proxy helpers", () => {
  it("rewrites NETWORK_HOST paths to /network, leaving assets, APIs and crawler files", () => {
    expect(networkRewritePath("/")).toBe("/network");
    expect(networkRewritePath("/dealers")).toBe("/network/dealers");
    for (const p of ["/api/network/image", "/_next/data/x", "/uploads/a/b.webp", "/robots.txt", "/sitemap.xml", "/network", "/network/dealers", "/sw.js"]) expect(networkRewritePath(p)).toBeNull();
  });
  it("redirects PLATFORM_HOST/network only when NETWORK_HOST is set", () => {
    expect(platformNetworkRedirect("platform.example", "/network/dealers", withNetwork)).toBe("https://network.example/dealers");
    expect(platformNetworkRedirect("platform.example", "/network", withNetwork)).toBe("https://network.example/");
    expect(platformNetworkRedirect("platform.example", "/networking", withNetwork)).toBeNull();
    expect(platformNetworkRedirect("platform.example", "/network", platformOnly)).toBeNull();
    expect(platformNetworkRedirect("shop.example", "/network", withNetwork)).toBeNull();
  });
});
