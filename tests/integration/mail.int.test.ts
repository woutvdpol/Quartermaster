import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { hashToken } from "@/server/auth/tokens";
import { queueMail, queueOrderConfirmation, requestPasswordResetEmail } from "@/server/mail";
import { sendMail } from "@/server/mail/send";
import { setMailSinkForTests } from "@/server/mail/transport";
import { runJobNow } from "@/server/jobs/queue";
import { makeOrder, makeProduct } from "@/server/orders/test-fixtures";
import { createElement } from "react";
import PasswordReset from "@/emails/PasswordReset";
import { createTenantContext, resetDb } from "./helpers";
import { installHarness, linkIn, setSettings } from "./mail-harness";

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
  process.env.MAIL_FROM_FALLBACK = "no-reply@quartermaster.test";
});
afterEach(() => {
  h.uninstall();
  vi.unstubAllEnvs();
});

describe("order confirmation", () => {
  it("queues customer + owner mail once per order, branded per tenant", async () => {
    vi.stubEnv("APP_URL", "");
    const ctx = await createTenantContext();
    await setSettings(ctx.tenantId, "general", { shopName: "Concept Militaria", contactEmail: "info@concept.test" });
    await setSettings(ctx.tenantId, "mail", { fromName: "Concept", confirmationMessage: "We ship within 2 days." });
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "concept-militaria.nl", isPrimary: true } });
    const product = await makeProduct(ctx.tenantId, { title: "M35 helmet", price: 45000 });
    const order = await makeOrder(ctx.tenantId, { lines: [{ product }], paymentStatus: "PAID", email: "buyer@example.test", name: "Jan" });

    expect(await queueOrderConfirmation(ctx.tenantId, order.id)).toBe(true);
    expect(await queueOrderConfirmation(ctx.tenantId, order.id)).toBe(false); // idempotent
    expect(h.jobs.map((j) => [(j.data as { template: string }).template, j.options.inTransaction])).toEqual([
      ["order-confirmation-customer", true],
      ["order-confirmation-owner", true],
    ]);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmationSentAt).not.toBeNull();

    await h.drain();
    const [customer, owner] = h.mails;
    expect(customer).toMatchObject({
      from: '"Concept" <no-reply@quartermaster.test>',
      to: "buyer@example.test",
      replyTo: "info@concept.test",
      subject: `Your order #${order.number} at Concept`,
    });
    expect(String(customer.html)).toContain("M35 helmet");
    expect(String(customer.text)).toContain("We ship within 2 days.");
    expect(linkIn(customer, "/order/").toString()).toBe(`https://concept-militaria.nl/order/${order.uuid}`);
    expect(owner).toMatchObject({ to: "info@concept.test", replyTo: "buyer@example.test" });
    expect(String(owner.subject)).toContain(`New order #${order.number}`);
    expect(linkIn(owner, "/admin/orders/").toString()).toBe(`https://concept-militaria.nl/admin/orders/${order.id}`);
  });

  it("is tenant-scoped and skips the owner mail without a notification address", async () => {
    const a = await createTenantContext();
    const b = await createTenantContext();
    const product = await makeProduct(a.tenantId);
    const order = await makeOrder(a.tenantId, { lines: [{ product }] });

    expect(await queueOrderConfirmation(b.tenantId, order.id)).toBe(false);
    expect(h.jobs).toHaveLength(0);
    // A forged job for another tenant's order sends nothing.
    await runJobNow("mail.send", { tenantId: b.tenantId, template: "order-confirmation-customer", props: { orderId: order.id } });
    expect(h.mails).toHaveLength(0);

    expect(await queueOrderConfirmation(a.tenantId, order.id)).toBe(true);
    expect(await h.drain()).toEqual([expect.objectContaining({ status: "sent" }), { status: "skipped" }]);
    expect(h.mails).toHaveLength(1);
  });

  it("can join the caller's transaction (rolled back → nothing queued, nothing claimed)", async () => {
    const ctx = await createTenantContext();
    const product = await makeProduct(ctx.tenantId);
    const order = await makeOrder(ctx.tenantId, { lines: [{ product }] });
    await expect(
      db.$transaction(async (tx) => {
        await queueOrderConfirmation(ctx.tenantId, order.id, { tx });
        throw new Error("finalize failed");
      }),
    ).rejects.toThrow("finalize failed");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmationSentAt).toBeNull();
  });
});

describe("password reset mail", () => {
  it("mails a working reset link without leaking the token into the job payload", async () => {
    const ctx = await createTenantContext();
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop.localhost:3000", isPrimary: true } });
    await requestPasswordResetEmail(ctx.tenantId, ctx.actor.email, "admin");
    expect(h.jobs).toHaveLength(1);
    const payload = JSON.stringify(h.jobs[0].data);

    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0].to).toBe(ctx.actor.email);
    const link = linkIn(h.mails[0], "/admin/reset-password");
    expect(link.origin).toBe("http://shop.localhost:3000");
    const token = link.searchParams.get("token")!;
    expect(payload).not.toContain(token);
    const row = await db.authToken.findFirstOrThrow({ where: { userId: ctx.actor.id, type: "PASSWORD_RESET" } });
    expect(row.tokenHash).toBe(hashToken(token));
  });

  it("queues nothing for unknown accounts", async () => {
    const ctx = await createTenantContext();
    await requestPasswordResetEmail(ctx.tenantId, "nobody@example.test", "customer");
    expect(h.jobs).toHaveLength(0);
  });

  it("platform (superadmin) mail uses Quartermaster branding", async () => {
    await queueMail({ tenantId: null, template: "password-reset", props: { tokenEnc: (await import("@/server/auth/encryption")).encrypt("tok"), audience: "admin" }, to: "root@example.test" });
    await h.drain();
    expect(h.mails[0]).toMatchObject({ from: '"Quartermaster" <no-reply@quartermaster.test>', subject: "Reset your Quartermaster password" });
  });

  it("rejects invalid payloads at enqueue time", async () => {
    await expect(queueMail({ tenantId: "t", template: "password-reset", props: { audience: "admin" } as never, to: "a@b.test" })).rejects.toThrow();
    expect(h.jobs).toHaveLength(0);
  });
});

describe("dev transport", () => {
  it("writes .eml files when SMTP_URL is unset", async () => {
    setMailSinkForTests(null);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qm-mail-"));
    vi.stubEnv("MAIL_OUTBOX_DIR", dir);
    vi.stubEnv("SMTP_URL", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const brand = { name: "X", baseUrl: "http://x.test", logoUrl: null, colors: { primary: "#000000", secondary: "#111111", accent: "#222222" }, contactEmail: null, address: "" };
      const sent = await sendMail({
        tenantId: null,
        to: "dev@example.test",
        subject: "Hello dev",
        react: createElement(PasswordReset, { brand, resetUrl: "http://x.test/r", expiresInMinutes: 30 }),
        headers: { "X-Test": "1" },
      });
      expect(sent.file).toBeDefined();
      expect(path.dirname(sent.file!)).toBe(dir);
      const eml = await fs.readFile(sent.file!, "utf8");
      expect(eml).toContain("Subject: Hello dev");
      expect(eml).toContain("To: dev@example.test");
      expect(eml).toContain("X-Test: 1");
      expect(eml).toContain("Content-Type: text/html");
      expect(eml).toContain("Content-Type: text/plain");
      expect(log).toHaveBeenCalledWith(expect.stringContaining(sent.file!));
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
