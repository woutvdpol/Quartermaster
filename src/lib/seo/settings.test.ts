import { describe, expect, it } from "vitest";
import { contentSchema, defaultSettings, legalSchema } from "@/server/settings/schema";
import { SETTINGS_FORMS, groupFields } from "@/app/admin/(app)/settings/_fields";

describe("SEO settings", () => {
  it("defaults: AI training allowed, no description / profiles, 14-day returns paid by the customer", () => {
    expect(defaultSettings("content").seo).toEqual({ description: "", allowAiTraining: true, sameAs: [] });
    expect(defaultSettings("legal").returns).toEqual({ days: 14, fees: "customer" });
  });

  it("stored settings without the new keys still parse (existing shops)", () => {
    expect(contentSchema.parse({ contactForm: false }).seo.allowAiTraining).toBe(true);
    expect(legalSchema.parse({ minimumAge: 18 }).returns.days).toBe(14);
  });

  it("profiles must be https URLs", () => {
    expect(contentSchema.safeParse({ seo: { sameAs: ["https://www.instagram.com/shop"] } }).success).toBe(true);
    expect(contentSchema.safeParse({ seo: { sameAs: ["http://insecure.example"] } }).success).toBe(false);
    expect(contentSchema.safeParse({ seo: { sameAs: ["javascript:alert(1)"] } }).success).toBe(false);
  });

  it("return window is bounded", () => {
    expect(legalSchema.safeParse({ returns: { days: 366 } }).success).toBe(false);
    expect(legalSchema.safeParse({ returns: { days: 0, fees: "free" } }).success).toBe(true);
  });

  it("admin settings expose the new fields", () => {
    const content = groupFields("content").map((f) => f.path);
    expect(content).toEqual(expect.arrayContaining(["seo.description", "seo.allowAiTraining", "seo.sameAs"]));
    expect(groupFields("legal").map((f) => f.path)).toEqual(expect.arrayContaining(["returns.days", "returns.fees"]));
    expect(SETTINGS_FORMS.content.sections.some((s) => s.title === "Search engines & AI assistants")).toBe(true);
  });
});
