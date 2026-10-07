import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { inviteOwner } from "@/server/users";
import { createTenant } from "@/server/platform";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness, linkIn } from "../../../tests/integration/mail-harness";
import "./hooks";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
});
afterEach(() => h.uninstall());

describe("owner invite mail", () => {
  it("is queued by the users notifier and links to the set-password page with the live token", async () => {
    const ctx = await createTenantContext();
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop.test", isPrimary: true } });
    const res = await inviteOwner(ctx, { email: "new-owner@example.test", name: "Nieuwe Eigenaar" });
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe("new-owner@example.test");
    const link = linkIn(h.mails[0], "/admin/reset-password");
    expect(link.searchParams.get("token")).toBe(res.token);
    expect(link.host).toBe("shop.test");
  });

  it("is queued for the first owner when the platform creates a tenant", async () => {
    const root = await db.user.create({ data: { role: "SUPERADMIN", tenantId: null, email: "root@qm.test" } });
    const res = await createTenant(
      { actor: { id: root.id, role: root.role, tenantId: null, email: root.email } },
      { slug: "invite-shop", name: "Invite Shop", primaryHost: "invite.test", ownerEmail: "first-owner@example.test" },
    );
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe("first-owner@example.test");
    const link = linkIn(h.mails[0], "/admin/reset-password");
    expect(link.searchParams.get("token")).toBe(res.inviteToken);
    expect(link.host).toBe("invite.test");
  });
});
