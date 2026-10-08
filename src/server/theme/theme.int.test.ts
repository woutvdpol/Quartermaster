import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { cookies } from "next/headers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { createSession, destroySession } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { LocalDriver, setStorageForTests } from "@/server/media/storage";
import { THEME_PREVIEW_COOKIE } from "@/lib/theme-preview";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { THEME_DRAFT_GROUP, applyPreset, discardThemeDraft, getThemeState, publishThemeDraft, saveThemeDraft, storeThemeLogo } from "./index";
import { getThemePreview } from "./preview";

async function expectError(p: Promise<unknown>, code: ServiceError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
}

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "qm-theme-int-"));
  setStorageForTests(new LocalDriver(root));
});
afterAll(async () => {
  setStorageForTests(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe("theme builder: draft / publish / discard", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
  });

  it("saves a draft without touching the live appearance", async () => {
    const before = await getThemeState(a);
    expect(before.draft).toBeNull();
    const state = await saveThemeDraft(a, applyPreset(before.live, "archive"));
    expect(state.draft?.theme).toBe("archive");
    expect(state.changes).toContain("theme");
    expect((await getSettings(a.tenantId, "appearance")).theme).toBe("gallery");
    // A draft equal to the live theme is no draft.
    expect((await saveThemeDraft(a, before.live)).draft).toBeNull();
    expect(await db.setting.count({ where: { tenantId: a.tenantId, group: THEME_DRAFT_GROUP } })).toBe(0);
  });

  it("rejects invalid drafts and foreign logo paths", async () => {
    const { live } = await getThemeState(a);
    await expectError(saveThemeDraft(a, { ...live, theme: "neon" }), "INVALID");
    await expectError(saveThemeDraft(a, { ...live, colors: { ...live.colors, primary: "blue" } }), "INVALID");
    await expectError(saveThemeDraft(a, { ...live, logoPath: `/uploads/${b.tenantId}/branding/logo-aa.webp` }), "INVALID");
    await saveThemeDraft(a, { ...live, logoPath: `/uploads/${a.tenantId}/branding/logo-aa.webp` });
  });

  it("publishes the draft to appearance, audits and removes the draft", async () => {
    const { live } = await getThemeState(a);
    await saveThemeDraft(a, { ...applyPreset(live, "vault"), density: "compact" });
    const state = await publishThemeDraft(a);
    expect(state.draft).toBeNull();
    expect(state.live).toMatchObject({ theme: "vault", density: "compact", headingFont: "Libre Caslon Display" });
    const appearance = await getSettings(a.tenantId, "appearance");
    expect(appearance).toMatchObject({ theme: "vault", corners: "sharp", buttonShape: "square" });
    const actions = (await db.auditLog.findMany({ where: { tenantId: a.tenantId }, select: { action: true } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["settings.update", "theme.publish"]));
    await expectError(publishThemeDraft(a), "CONFLICT");
  });

  it("discards the draft", async () => {
    const { live } = await getThemeState(a);
    await saveThemeDraft(a, applyPreset(live, "fieldkit"));
    expect((await discardThemeDraft(a)).draft).toBeNull();
    expect((await getSettings(a.tenantId, "appearance")).theme).toBe("gallery");
  });

  it("keeps drafts per tenant", async () => {
    const { live } = await getThemeState(a);
    await saveThemeDraft(a, applyPreset(live, "fieldkit"));
    expect((await getThemeState(b)).draft).toBeNull();
    await expectError(publishThemeDraft(b), "CONFLICT");
    await discardThemeDraft(b);
    expect((await getThemeState(a)).draft?.theme).toBe("fieldkit");
  });

  it("stores an uploaded logo under the tenant's branding path and rejects non-images", async () => {
    const png = await sharp({ create: { width: 1600, height: 400, channels: 4, background: { r: 20, g: 40, b: 30, alpha: 0.5 } } }).png().toBuffer();
    const p = await storeThemeLogo(a, new Uint8Array(png));
    expect(p).toMatch(new RegExp(`^/uploads/${a.tenantId}/branding/logo-[0-9a-f]{12}\\.webp$`));
    const meta = await sharp(path.join(root, p.replace("/uploads/", ""))).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 800, height: 200, hasAlpha: true });
    await expectError(storeThemeLogo(a, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), "INVALID");
    await expectError(storeThemeLogo(a, new Uint8Array()), "INVALID");
  });
});

describe("theme preview access", () => {
  let a: ServiceContext;
  let b: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    a = await createTenantContext();
    b = await createTenantContext();
    const { live } = await getThemeState(a);
    await saveThemeDraft(a, applyPreset(live, "vault"));
    await destroySession();
    (await cookies()).delete(THEME_PREVIEW_COOKIE);
  });

  it("is off without the preview cookie, even for staff", async () => {
    await createSession(a.actor.id, "OWNER");
    expect(await getThemePreview(a.tenantId)).toBeNull();
  });

  it("denies guests that set the cookie", async () => {
    (await cookies()).set(THEME_PREVIEW_COOKIE, "1");
    expect(await getThemePreview(a.tenantId)).toBeNull();
  });

  it("shows the draft to the tenant's own staff only", async () => {
    (await cookies()).set(THEME_PREVIEW_COOKIE, "1");
    await createSession(a.actor.id, "OWNER");
    expect((await getThemePreview(a.tenantId))?.draft?.theme).toBe("vault");
    await destroySession();
    await createSession(b.actor.id, "OWNER");
    expect(await getThemePreview(a.tenantId)).toBeNull();
  });

  it("denies customers of the shop", async () => {
    const customer = await db.user.create({ data: { role: "CUSTOMER", tenantId: a.tenantId, email: "c@test.local" } });
    (await cookies()).set(THEME_PREVIEW_COOKIE, "1");
    await createSession(customer.id, "CUSTOMER");
    expect(await getThemePreview(a.tenantId)).toBeNull();
  });
});

describe("theme preview host", () => {
  beforeEach(resetDb);

  it("matches any of the tenant's domains, with or without port", async () => {
    const { hostBelongsToTenant } = await import("./preview");
    expect(hostBelongsToTenant("demo-onboarding.localhost:3000", ["demo-onboarding.localhost:3000"])).toBe(true);
    expect(hostBelongsToTenant("Demo-Onboarding.localhost:3000", ["demo-onboarding.localhost"])).toBe(true);
    expect(hostBelongsToTenant("shop.example", ["www.shop.example", "shop.example"])).toBe(true);
    expect(hostBelongsToTenant("other.localhost:3000", ["demo-onboarding.localhost:3000"])).toBe(false);
    expect(hostBelongsToTenant(null, ["x"])).toBe(false);
  });

  it("is available on a non-primary platform subdomain of the tenant and not on another tenant's host", async () => {
    const { themePreviewHostInfo } = await import("./preview");
    const a = await createTenantContext();
    const b = await createTenantContext();
    await db.tenantDomain.createMany({
      data: [
        { tenantId: a.tenantId, host: "shop-a.example", isPrimary: true },
        { tenantId: a.tenantId, host: "demo-onboarding.localhost:3000", isPrimary: false },
        { tenantId: b.tenantId, host: "shop-b.localhost:3000", isPrimary: true },
      ],
    });
    expect(await themePreviewHostInfo(a.tenantId, "demo-onboarding.localhost:3000")).toEqual({ available: true, primaryHost: "shop-a.example" });
    expect(await themePreviewHostInfo(a.tenantId, "shop-a.example")).toMatchObject({ available: true });
    expect(await themePreviewHostInfo(a.tenantId, "shop-b.localhost:3000")).toEqual({ available: false, primaryHost: "shop-a.example" });
    expect(await themePreviewHostInfo(b.tenantId, "demo-onboarding.localhost:3000")).toMatchObject({ available: false });
  });
});
