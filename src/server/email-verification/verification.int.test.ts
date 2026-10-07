import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { installHarness, linkIn } from "../../../tests/integration/mail-harness";
import { sendCustomerVerification, verifyCustomerEmail } from "./index";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
});
afterEach(() => h.uninstall());

async function customer(tenantId: string, email = "jan@example.test") {
  return db.user.create({ data: { tenantId, role: "CUSTOMER", email } });
}

describe("customer email verification", () => {
  it("mails a link that verifies once, only on the issuing shop; older links stop working", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    await db.tenantDomain.create({ data: { tenantId: a.tenantId, host: "shop-a.test", isPrimary: true } });
    const user = await customer(a.tenantId);

    expect(await sendCustomerVerification(a.tenantId, user.id)).toEqual({ sent: true });
    await h.drain();
    const first = linkIn(h.mails[0], "/account/verify-email").searchParams.get("token")!;
    expect(h.mails[0].to).toBe("jan@example.test");

    await sendCustomerVerification(a.tenantId, user.id);
    await h.drain();
    const second = linkIn(h.mails[1], "/account/verify-email").searchParams.get("token")!;

    expect(await verifyCustomerEmail(a.tenantId, first)).toEqual({ ok: false, error: "invalid_token" }); // superseded
    expect(await verifyCustomerEmail(b.tenantId, second)).toEqual({ ok: false, error: "invalid_token" }); // other shop
    expect(await verifyCustomerEmail(a.tenantId, second)).toEqual({ ok: true, email: "jan@example.test" });
    expect(await verifyCustomerEmail(a.tenantId, second)).toEqual({ ok: false, error: "invalid_token" }); // used
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect(await sendCustomerVerification(a.tenantId, user.id)).toEqual({ sent: false, reason: "already_verified" });
  });

  it("refuses other tenants' users and staff accounts", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const user = await customer(a.tenantId);
    expect(await sendCustomerVerification(b.tenantId, user.id)).toEqual({ sent: false, reason: "not_found" });
    expect(await sendCustomerVerification(a.tenantId, a.actor.id)).toEqual({ sent: false, reason: "not_found" });
  });
});
