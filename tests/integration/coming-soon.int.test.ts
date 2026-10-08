import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { getLaunchState, getOpenShopTenant } from "@/server/storefront/launch";
import { getLegalLinks, withoutMenuDuplicates } from "@/server/storefront/content";
import { resetDb } from "./helpers";

// Outside Next there is no data cache; run cached storefront reads directly.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
// The request host decides the tenant; tests pick it directly.
const scope = vi.hoisted(() => ({ tenantId: null as string | null }));
vi.mock("@/server/tenant", () => {
  const resolve = async () => {
    if (!scope.tenantId) return { kind: "unknown" as const };
    const { db: client } = await import("@/server/db");
    const tenant = await client.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
    return { kind: "tenant" as const, tenant };
  };
  return {
    normalizeHost: (h: string | null | undefined) => (h ? h.trim().toLowerCase() : null),
    isPlatformHost: () => false,
    getRequestScope: resolve,
    getRequestTenant: async () => {
      const s = await resolve();
      return s.kind === "tenant" ? s.tenant : null;
    },
  };
});


beforeEach(async () => {
  await resetDb();
  scope.tenantId = null;
});

async function shop(setup: { setupState: object | null; completed?: boolean }) {
  const t = await db.tenant.create({
    data: {
      slug: `s-${Math.random().toString(36).slice(2, 8)}`,
      name: "Shop",
      ...(setup.setupState ? { setupState: setup.setupState } : {}),
      setupCompletedAt: setup.completed ? new Date() : null,
    },
  });
  scope.tenantId = t.id;
  return t;
}

describe("coming soon", () => {
  it("leaves existing shops (setupState null) and launched shops open", async () => {
    const t = await shop({ setupState: null });
    expect(await getLaunchState()).toEqual({ prelaunch: false });
    expect((await getOpenShopTenant())?.id).toBe(t.id);

    const launched = await shop({ setupState: {}, completed: true });
    expect(await getLaunchState()).toEqual({ prelaunch: false });
    expect((await getOpenShopTenant())?.id).toBe(launched.id);
  });

  it("blocks storefront actions for visitors and customers of a shop in the wizard", async () => {
    const t = await shop({ setupState: {} });
    expect(await getLaunchState()).toEqual({ prelaunch: true, staff: false });
    expect(await getOpenShopTenant()).toBeNull();

    const customer = await db.user.create({ data: { role: "CUSTOMER", tenantId: t.id, email: "c@x.test" } });
    await createSession(customer.id, "CUSTOMER");
    expect(await getOpenShopTenant()).toBeNull();
  });
});

describe("coming soon for staff", () => {
  it("lets the shop's own owner use the shop (with the ribbon)", async () => {
    const t = await shop({ setupState: {} });
    const owner = await db.user.create({ data: { role: "OWNER", tenantId: t.id, email: "o@x.test" } });
    await createSession(owner.id, "OWNER");
    expect(await getLaunchState()).toEqual({ prelaunch: true, staff: true });
    expect((await getOpenShopTenant())?.id).toBe(t.id);
  });
});

describe("footer legal links", () => {
  it("lists published returns and shipping pages after the system pages, without menu duplicates", async () => {
    const t = await shop({ setupState: null });
    const page = (slug: string, title: string, systemKey: string | null, published = true) =>
      db.contentPage.create({ data: { tenantId: t.id, slug, title, systemKey, publishedAt: published ? new Date() : null } });
    await page("contact", "Contact", "CONTACT");
    await page("shipping", "Shipping and delivery", null);
    await page("terms", "Terms", "TERMS");
    await page("returns", "Returns", null);
    await page("privacy", "Privacy", "PRIVACY", false);

    const links = await getLegalLinks(t.id);
    expect(links.map((l) => l.key)).toEqual(["TERMS", "RETURNS", "SHIPPING", "CONTACT"]);
    expect(links.find((l) => l.key === "RETURNS")?.href).toBe("/returns");

    const menu = [
      { id: "m1", label: "Service", href: null, external: false, children: [
        { id: "m2", label: "Returns", href: "/returns", external: false, children: [] },
        { id: "m3", label: "Contact", href: "/contact", external: false, children: [] },
      ] },
    ];
    // Returns is already in the footer menu; system links always stay.
    expect(withoutMenuDuplicates(links, menu).map((l) => l.key)).toEqual(["TERMS", "SHIPPING", "CONTACT"]);
  });
});
