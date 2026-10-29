import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/lib/admin-nav";
import { MODULES, MODULE_IDS, NEWSLETTER_MODULE_QUOTA, PLANS, moduleForNavKey, planAddedModules } from "./catalog";
import { resolveEntitlements, type ModuleRow } from "./resolve";

const navKeys = new Set(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key)));
const NOW = new Date("2026-10-13T12:00:00Z");

describe("module catalog", () => {
  it("has a definition for every id, keyed by its own id", () => {
    for (const id of MODULE_IDS) expect(MODULES[id].id).toBe(id);
    expect(Object.keys(MODULES).sort()).toEqual([...MODULE_IDS].sort());
  });

  it("only refers to existing admin nav items, each owned by at most one module", () => {
    const seen = new Set<string>();
    for (const id of MODULE_IDS) {
      for (const key of MODULES[id].navKeys) {
        expect(navKeys.has(key), `${id} → ${key}`).toBe(true);
        expect(seen.has(key), `${key} owned twice`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("lists what each package adds over the one below it (platform landing pricing)", () => {
    expect(planAddedModules("START")).toEqual([]);
    expect(planAddedModules("PRO")).toEqual(["offers", "coupons", "newsletter", "alerts", "insights"]);
    expect(planAddedModules("COMPLETE")).toEqual(["auctions", "fairs", "leads", "smartSearch", "translations", "provenance"]);
  });

  it("maps nav items back to their module; core items have none", () => {
    expect(moduleForNavKey("auctions")).toBe("auctions");
    expect(moduleForNavKey("sourcing")).toBe("provenance");
    expect(moduleForNavKey("orders")).toBeUndefined();
    expect(moduleForNavKey("dashboard")).toBeUndefined();
  });

  it("has no unknown or circular requirements", () => {
    for (const id of MODULE_IDS) {
      for (const dep of MODULES[id].requires) expect(MODULE_IDS).toContain(dep);
      expect(MODULES[id].requires).not.toContain(id);
    }
  });

  it("prices packages below the sum of their modules, and Complete contains everything", () => {
    for (const plan of Object.values(PLANS)) {
      const sum = PLANS.START.priceCents + plan.modules.reduce((s, m) => s + MODULES[m].priceCents, 0);
      expect(plan.priceCents).toBeLessThanOrEqual(sum);
    }
    expect([...PLANS.COMPLETE.modules].sort()).toEqual([...MODULE_IDS].sort());
    expect(PLANS.START.modules).toEqual([]);
  });
});

describe("resolveEntitlements", () => {
  it("defaults to Start when a shop has no plan row (fail closed)", () => {
    const e = resolveEntitlements(null, [], NOW);
    expect(e.plan).toBe("START");
    expect(e.modules.size).toBe(0);
    expect(e.limits).toEqual(PLANS.START.limits);
  });

  it("grants the package modules and limits", () => {
    const e = resolveEntitlements({ plan: "PRO", productLimit: null, photoLimit: null, storageGb: null, newsletterQuota: null }, [], NOW);
    expect([...e.modules].sort()).toEqual([...PLANS.PRO.modules].sort());
    expect(e.limits.productLimit).toBe(500);
    expect(e.modules.has("auctions")).toBe(false);
  });

  it("adds active, past-due and running-trial extras; skips cancelled, expired trials and unknown ids", () => {
    const rows: ModuleRow[] = [
      { moduleId: "auctions", status: "ACTIVE", trialEndsAt: null },
      { moduleId: "fairs", status: "PAST_DUE", trialEndsAt: null },
      { moduleId: "insights", status: "TRIAL", trialEndsAt: new Date("2026-10-20T00:00:00Z") },
      { moduleId: "offers", status: "TRIAL", trialEndsAt: new Date("2026-10-01T00:00:00Z") },
      { moduleId: "coupons", status: "CANCELLED", trialEndsAt: null },
      { moduleId: "removedModule", status: "ACTIVE", trialEndsAt: null },
    ];
    const e = resolveEntitlements(null, rows, NOW);
    expect([...e.modules].sort()).toEqual(["auctions", "fairs", "insights"]);
    expect([...e.trials.keys()]).toEqual(["insights"]);
  });

  it("gives the newsletter module its own quota on top of a package without it", () => {
    const e = resolveEntitlements(null, [{ moduleId: "newsletter", status: "ACTIVE", trialEndsAt: null }], NOW);
    expect(e.limits.newsletterQuota).toBe(NEWSLETTER_MODULE_QUOTA);
  });

  it("applies superadmin overrides; a legacy newsletter quota of -1 means unlimited", () => {
    const e = resolveEntitlements({ plan: "START", productLimit: 250, photoLimit: 8, storageGb: 12, newsletterQuota: -1 }, [], NOW);
    expect(e.limits).toEqual({ productLimit: 250, photoLimit: 8, storageGb: 12, newsletterQuota: null });
  });

  it("gives Complete every module with unlimited products", () => {
    const e = resolveEntitlements({ plan: "COMPLETE", productLimit: null, photoLimit: null, storageGb: null, newsletterQuota: null }, [], NOW);
    expect(e.modules.size).toBe(MODULE_IDS.length);
    expect(e.limits.productLimit).toBeNull();
  });
});

describe("module paths", async () => {
  const { moduleForPath, withoutLockedLinks } = await import("./paths");
  const none = Object.fromEntries(MODULE_IDS.map((id) => [id, false])) as Record<(typeof MODULE_IDS)[number], boolean>;

  it("maps storefront paths to modules, with or without a locale prefix", () => {
    expect(moduleForPath("/auctions")).toBe("auctions");
    expect(moduleForPath("/nl/auctions/spring-sale?x=1")).toBe("auctions");
    expect(moduleForPath("/sell")).toBe("leads");
    expect(moduleForPath("/account/alerts")).toBe("alerts");
    expect(moduleForPath("/account")).toBeUndefined();
    expect(moduleForPath("/seller-info")).toBeUndefined();
    expect(moduleForPath("https://example.com/auctions")).toBeUndefined();
  });

  it("drops menu links to locked modules but keeps headings, external links and core links", () => {
    const menu = [
      { label: "Shop", href: null, external: false, children: [
        { label: "Auctions", href: "/auctions", external: false, children: [] },
        { label: "All items", href: "/shop", external: false, children: [] },
      ] },
      { label: "Sell", href: "/sell", external: false, children: [] },
      { label: "Partner", href: "https://example.com/sell", external: true, children: [] },
    ];
    const out = withoutLockedLinks(menu, none);
    expect(out.map((i) => i.label)).toEqual(["Shop", "Partner"]);
    expect(out[0].children.map((i) => i.label)).toEqual(["All items"]);
    expect(withoutLockedLinks(menu, { ...none, auctions: true, leads: true })).toHaveLength(3);
  });
});
