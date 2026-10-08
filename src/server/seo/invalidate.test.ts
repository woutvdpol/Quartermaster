import { describe, expect, it } from "vitest";
import { shopTagsForAction } from "@/server/storefront/cache";

/*
 * Sitemaps, the merchant feed, llms.txt and structured data read through shopCache (src/server/seo).
 * These audited actions must invalidate the areas those reads are tagged with.
 */
describe("SEO cache invalidation", () => {
  it.each([
    ["product.update", "tenant:t1:catalog"],
    ["product.status", "tenant:t1:catalog"],
    ["product.images.added", "tenant:t1:catalog"],
    ["category.update", "tenant:t1:catalog"],
    ["facet.update", "tenant:t1:catalog"],
    ["compliance.rule.update", "tenant:t1:catalog"],
    ["order.mark_paid", "tenant:t1:catalog"],
    ["content.page.publish", "tenant:t1:content"],
    ["settings.update", "tenant:t1"],
    ["shipping.zone.update", "tenant:t1"],
    ["domain.add", "tenant:t1"],
  ])("%s → %s", (action, tag) => {
    expect(shopTagsForAction("t1", action)).toContain(tag);
  });
});
