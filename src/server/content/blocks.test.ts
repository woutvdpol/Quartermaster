import { describe, expect, it } from "vitest";
import {
  BLOCK_CATALOG,
  BLOCK_DEFAULTS,
  BLOCK_TYPES,
  blockReferences,
  contentBlockSchema,
  defaultBlockData,
  parseBlock,
} from "./blocks";
import { ContentBlockType } from "@/generated/prisma/enums";
import { SYSTEM_PAGE_STARTER_BLOCKS } from "./starter";

describe("block schemas", () => {
  it("cover every ContentBlockType exactly once, also in the catalog", () => {
    expect([...BLOCK_TYPES].sort()).toEqual(Object.values(ContentBlockType).sort());
    expect(BLOCK_CATALOG.map((e) => e.type).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it.each(BLOCK_TYPES)("default data for %s is valid", (type) => {
    const res = parseBlock(type, BLOCK_DEFAULTS[type]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.block.data).toEqual(BLOCK_DEFAULTS[type]);
  });

  it("defaultBlockData returns a copy", () => {
    const d = defaultBlockData("GALLERY");
    d.imageKeys.push("t/x.jpg");
    expect(BLOCK_DEFAULTS.GALLERY.imageKeys).toEqual([]);
  });

  it("system page starter blocks are valid", () => {
    for (const blocks of Object.values(SYSTEM_PAGE_STARTER_BLOCKS)) {
      for (const b of blocks) expect(parseBlock(b.type, b.data).ok).toBe(true);
    }
  });

  it("fills defaults and strips unknown keys", () => {
    const res = parseBlock("TEXT", { markdown: "hi", evil: "<script>" });
    expect(res).toEqual({ ok: true, block: { type: "TEXT", data: { title: "", markdown: "hi", cta: null } } });
  });

  it("rejects unknown types", () => {
    expect(parseBlock("EMAILER", {}).ok).toBe(false);
  });

  it("enforces NEW_ITEMS count 1–24", () => {
    expect(parseBlock("NEW_ITEMS", { count: 0 }).ok).toBe(false);
    expect(parseBlock("NEW_ITEMS", { count: 25 }).ok).toBe(false);
    expect(parseBlock("NEW_ITEMS", { count: 1.5 }).ok).toBe(false);
    expect(parseBlock("NEW_ITEMS", { count: 24 }).ok).toBe(true);
  });

  it("requires the mandatory fields", () => {
    expect(parseBlock("HERO", {}).ok).toBe(false);
    expect(parseBlock("CTA", { title: "x", buttonLabel: "Go" }).ok).toBe(false);
    expect(parseBlock("TESTIMONIAL", { quote: "q" }).ok).toBe(false);
    expect(parseBlock("QUOTE", { quote: "  " }).ok).toBe(false);
    expect(parseBlock("NEWSLETTER_SIGNUP", { title: "Join" }).ok).toBe(true);
  });

  it("rejects unsafe link targets", () => {
    const bad = parseBlock("CTA", { title: "x", buttonLabel: "Go", href: "javascript:alert(1)" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0].path).toBe("href");
    expect(parseBlock("TEXT", { markdown: "", cta: { label: "x", href: "//evil.com" } }).ok).toBe(false);
    expect(parseBlock("CTA", { title: "x", buttonLabel: "Go", href: " /contact " })).toMatchObject({ ok: true, block: { data: { href: "/contact" } } });
  });

  it("validates image keys", () => {
    expect(parseBlock("GALLERY", { imageKeys: ["t1/content/a.jpg"] }).ok).toBe(true);
    expect(parseBlock("GALLERY", { imageKeys: ["../etc/passwd"] }).ok).toBe(false);
    expect(parseBlock("GALLERY", { imageKeys: ["/abs.jpg"] }).ok).toBe(false);
    expect(parseBlock("GALLERY", { imageKeys: ["https://x.com/a.jpg"] }).ok).toBe(false);
    expect(parseBlock("GALLERY", { imageKeys: ["t/a.jpg", "t/a.jpg"] }).ok).toBe(false);
  });

  it("discriminated union parses { type, data }", () => {
    expect(contentBlockSchema.safeParse({ type: "QUOTE", data: { quote: "x" } }).success).toBe(true);
    expect(contentBlockSchema.safeParse({ type: "QUOTE", data: {} }).success).toBe(false);
    expect(contentBlockSchema.safeParse({ type: "NOPE", data: {} }).success).toBe(false);
  });

  it("collects references", () => {
    const res = parseBlock("TEXT_IMAGE", { imageKey: "t/a.jpg" });
    expect(res.ok && blockReferences(res.block)).toEqual({ imageKeys: ["t/a.jpg"], productIds: [], categoryIds: [] });
    const p = parseBlock("TEXT_PRODUCT", { productId: "p1" });
    expect(p.ok && blockReferences(p.block).productIds).toEqual(["p1"]);
  });

  it("FAQ: 1–30 items, question ≤ 200, answer Markdown ≤ 2000, no duplicate questions", () => {
    const item = (q: string, a = "Answer") => ({ question: q, answer: a });
    const ok = parseBlock("FAQ", { items: [item(" Shipping? ", " Yes ")] });
    expect(ok).toEqual({ ok: true, block: { type: "FAQ", data: { title: "", items: [item("Shipping?", "Yes")] } } });
    expect(parseBlock("FAQ", {}).ok).toBe(false);
    expect(parseBlock("FAQ", { items: [] }).ok).toBe(false);
    expect(parseBlock("FAQ", { items: Array.from({ length: 30 }, (_, i) => item(`Q${i}`)) }).ok).toBe(true);
    expect(parseBlock("FAQ", { items: Array.from({ length: 31 }, (_, i) => item(`Q${i}`)) }).ok).toBe(false);
    expect(parseBlock("FAQ", { items: [item("q".repeat(200))] }).ok).toBe(true);
    expect(parseBlock("FAQ", { items: [item("q".repeat(201))] }).ok).toBe(false);
    expect(parseBlock("FAQ", { items: [item("Q", "a".repeat(2000))] }).ok).toBe(true);
    expect(parseBlock("FAQ", { items: [item("Q", "a".repeat(2001))] }).ok).toBe(false);
    expect(parseBlock("FAQ", { items: [item("Q", "   ")] }).ok).toBe(false);
    expect(parseBlock("FAQ", { items: [item("   ")] }).ok).toBe(false);
    const dup = parseBlock("FAQ", { items: [item("Do you ship?"), item("do  you SHIP?")] });
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.issues[0].path).toBe("items.1.question");
  });
});
