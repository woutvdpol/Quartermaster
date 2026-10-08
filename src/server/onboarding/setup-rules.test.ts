import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_LENGTH } from "@/server/content/markdown";
import { EU_COUNTRIES } from "@/server/shipping/countries";
import { findCountryConflicts } from "@/server/shipping/validation";
import {
  LEGAL_PAGES,
  SETUP_STEPS,
  completedStepCount,
  firstOpenStep,
  isSetupPending,
  legalTemplateMarkdown,
  nextStep,
  parseSetupState,
  previousStep,
  shippingTemplateLabel,
  shippingTemplateZones,
  stepStatus,
  storefrontAccess,
  withStep,
} from "./setup-rules";

describe("setup state", () => {
  it("parses leniently", () => {
    const state = parseSetupState({ basics: { done: true, at: "x" }, bogus: { done: true }, look: "nope", payments: { done: false, skipped: true } });
    expect(Object.keys(state)).toEqual(["basics", "payments"]);
    expect(stepStatus(state, "basics")).toBe("done");
    expect(stepStatus(state, "payments")).toBe("skipped");
    expect(stepStatus(state, "shipping")).toBe("todo");
    expect(parseSetupState(null)).toEqual({});
  });

  it("finds the first open step and counts progress", () => {
    let state = parseSetupState({});
    expect(firstOpenStep(state)).toBe("basics");
    state = withStep(state, "basics", { done: true });
    state = withStep(state, "business", { done: true });
    state = withStep(state, "look", { done: false, skipped: true });
    expect(firstOpenStep(state)).toBe("payments");
    expect(completedStepCount(state)).toBe(3);
    for (const s of SETUP_STEPS) state = withStep(state, s.key, { done: true });
    expect(firstOpenStep(state)).toBe("golive");
  });

  it("navigates", () => {
    expect(nextStep("basics")).toBe("business");
    expect(nextStep("golive")).toBeNull();
    expect(previousStep("basics")).toBeNull();
    expect(previousStep("legal")).toBe("import");
  });

  it("is pending only for onboarding tenants that have not gone live", () => {
    expect(isSetupPending({ setupState: {}, setupCompletedAt: null })).toBe(true);
    expect(isSetupPending({ setupState: null, setupCompletedAt: null })).toBe(false);
    expect(isSetupPending({ setupState: {}, setupCompletedAt: new Date() })).toBe(false);
  });
});

describe("shipping templates", () => {
  it("never puts a country in two zones", () => {
    for (const home of ["NL", "BE", "DE", "US"]) {
      for (const t of ["domestic", "eu", "worldwide"] as const) {
        const zones = shippingTemplateZones(t, home).map((z, i) => ({ id: String(i), name: z.name, countries: z.countries, isPickup: false }));
        for (const z of zones) expect(findCountryConflicts(z, zones.filter((o) => o.id !== z.id))).toEqual([]);
      }
    }
  });

  it("builds Benelux + EU + rest of world for a Dutch shop", () => {
    const zones = shippingTemplateZones("worldwide", "NL");
    expect(zones.map((z) => z.name)).toEqual(["Netherlands", "Belgium & Luxembourg", "European Union", "Rest of world"]);
    expect(zones[2].countries).toHaveLength(EU_COUNTRIES.length - 3);
    expect(zones[3].countries).toEqual(["*"]);
    expect(zones.every((z) => z.rates.length === 3 && z.rates.every((r) => r.price > 0))).toBe(true);
    expect(shippingTemplateLabel("eu", "NL")).toBe("Benelux + EU");
    expect(shippingTemplateLabel("domestic", "DE")).toBe("Germany only");
  });
});

describe("legal templates", () => {
  const vars = { shopName: "Vries Militaria", email: "info@vries.nl", address: "Dorpsstraat 1, 1234 AB Utrecht", cocNumber: "12345678", vatNumber: "", country: "Netherlands" };
  it("fills in the shop's details and stays within the block limit", () => {
    for (const key of LEGAL_PAGES) {
      const md = legalTemplateMarkdown(key, vars);
      expect(md.length).toBeLessThan(MAX_MARKDOWN_LENGTH);
      expect(md).toContain("info@vries.nl");
    }
    expect(legalTemplateMarkdown("terms", vars)).toContain("Chamber of Commerce: 12345678");
    expect(legalTemplateMarkdown("terms", vars)).not.toContain("VAT:");
  });
  it("uses placeholders when details are missing", () => {
    const md = legalTemplateMarkdown("privacy", { ...vars, email: "", address: "" });
    expect(md).toContain("[your email address]");
  });
});

describe("storefront access while coming soon", () => {
  const live = { id: "t1", setupState: null, setupCompletedAt: null };
  const wizard = { id: "t1", setupState: {}, setupCompletedAt: null };
  const done = { id: "t1", setupState: {}, setupCompletedAt: new Date() };
  it("leaves existing and launched shops open", () => {
    expect(storefrontAccess(live, null)).toBe("open");
    expect(storefrontAccess(done, null)).toBe("open");
  });
  it("shows the shop only to its own owners before launch", () => {
    expect(storefrontAccess(wizard, null)).toBe("coming-soon");
    expect(storefrontAccess(wizard, { role: "CUSTOMER", tenantId: "t1" })).toBe("coming-soon");
    expect(storefrontAccess(wizard, { role: "OWNER", tenantId: "t2" })).toBe("coming-soon");
    expect(storefrontAccess(wizard, { role: "SUPERADMIN", tenantId: null })).toBe("coming-soon");
    expect(storefrontAccess(wizard, { role: "OWNER", tenantId: "t1" })).toBe("staff-preview");
  });
});
