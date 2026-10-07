import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import {
  confirmSubscription,
  createCampaign,
  deleteCampaign,
  deleteSubscribers,
  exportSubscribersCsv,
  getCampaign,
  getNewsletterQuota,
  listSubscribers,
  sendCampaign,
  sendTestCampaign,
  signUnsubscribe,
  subscribe,
  subscriberCounts,
  unsubscribeSigned,
  updateCampaign,
} from "@/server/newsletter";
import { runJobNow } from "@/server/jobs/queue";
import { setMailSinkForTests } from "@/server/mail/transport";
import { createTenantContext, resetDb } from "./helpers";
import { enableNewsletter, installHarness, linkIn } from "./mail-harness";

vi.mock("next/server", () => ({ connection: async () => {} }));

let h: ReturnType<typeof installHarness>;
beforeEach(async () => {
  await resetDb();
  h = installHarness();
});
afterEach(() => {
  h.uninstall();
  vi.unstubAllEnvs();
});

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function addSubscribers(tenantId: string, n: number, opts: { confirmed?: boolean; unsubscribed?: boolean; prefix?: string } = {}) {
  const now = new Date();
  await db.newsletterSubscriber.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      tenantId,
      email: `${opts.prefix ?? "sub"}${i}@example.test`,
      confirmedAt: opts.confirmed === false ? null : now,
      unsubscribedAt: opts.unsubscribed ? now : null,
    })),
  });
}

async function subscribeAndGetToken(tenantId: string, email: string) {
  const res = await subscribe(tenantId, email, { source: "footer" });
  expect(res.status).toBe("pending");
  await h.drain();
  const mail = h.mails.at(-1)!;
  return { res, mail, token: linkIn(mail, "/api/newsletter/confirm").searchParams.get("token")! };
}

describe("double opt-in", () => {
  it("subscribe → confirmation mail → confirm", async () => {
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);
    await db.tenantDomain.create({ data: { tenantId: ctx.tenantId, host: "shop-a.localhost:3000", isPrimary: true } });

    const res = await subscribe(ctx.tenantId, "  Jan@Example.TEST ", { source: "footer" });
    expect(res.status).toBe("pending");
    const row = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    expect(row).toMatchObject({ email: "jan@example.test", source: "footer", confirmedAt: null, unsubscribedAt: null });
    expect(row.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // The confirmation mail is queued in the same transaction; the job payload holds no raw token.
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0]).toMatchObject({ name: "mail.send", options: { inTransaction: true }, data: { template: "newsletter-confirm" } });
    expect(JSON.stringify(h.jobs[0].data)).not.toContain(row.confirmTokenHash!);

    await h.drain();
    expect(h.mails).toHaveLength(1);
    const mail = h.mails[0];
    expect(mail.to).toBe("jan@example.test");
    expect(mail.subject).toMatch(/confirm your subscription/i);
    const link = linkIn(mail, "/api/newsletter/confirm");
    expect(link.origin).toBe("http://shop-a.localhost:3000");

    const confirmed = await confirmSubscription(link.searchParams.get("token")!);
    expect(confirmed).toEqual({ ok: true, tenantId: ctx.tenantId, subscriberId: row.id });
    const after = await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.confirmedAt).not.toBeNull();
    expect(after.confirmTokenHash).toBeNull();
    expect(await db.auditLog.count({ where: { action: "newsletter.confirmed", tenantId: ctx.tenantId } })).toBe(1);

    // Token is single use; active subscribers get no new mail.
    expect(await confirmSubscription(link.searchParams.get("token")!)).toEqual({ ok: false, error: "invalid" });
    expect(await subscribe(ctx.tenantId, "jan@example.test")).toEqual({ status: "already_subscribed" });
    expect(h.jobs).toHaveLength(0);
  });

  it("requires the newsletter to be enabled and a valid email", async () => {
    const ctx = await createTenantContext();
    await expectServiceError(subscribe(ctx.tenantId, "a@example.test"), "UNAVAILABLE");
    await enableNewsletter(ctx.tenantId);
    await expectServiceError(subscribe(ctx.tenantId, "not-an-email"), "INVALID");
    await expectServiceError(subscribe(ctx.tenantId, "a@example.test", { source: "<script>" }), "INVALID");
    await expectServiceError(subscribe("missing-tenant", "a@example.test"), "NOT_FOUND");
  });

  it("expires tokens, supersedes old confirmation mails and rate-limits", async () => {
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);

    const first = await subscribeAndGetToken(ctx.tenantId, "x@example.test");
    // A second sign-up issues a new token: the old one stops working, an unsent old mail is skipped.
    await subscribe(ctx.tenantId, "x@example.test");
    expect(await confirmSubscription(first.token)).toEqual({ ok: false, error: "invalid" });
    await subscribe(ctx.tenantId, "x@example.test"); // 3rd within the hour
    const sentBefore = h.mails.length;
    const results = await h.drain();
    expect(results).toEqual([{ status: "skipped" }, expect.objectContaining({ status: "sent" })]);
    expect(h.mails.length).toBe(sentBefore + 1);
    expect(await subscribe(ctx.tenantId, "x@example.test")).toEqual({ status: "rate_limited" });

    const token = linkIn(h.mails.at(-1)!, "/api/newsletter/confirm").searchParams.get("token")!;
    await db.newsletterSubscriber.updateMany({ where: { tenantId: ctx.tenantId }, data: { confirmSentAt: new Date(Date.now() - 8 * 86400_000) } });
    expect(await confirmSubscription(token)).toEqual({ ok: false, error: "expired", tenantId: ctx.tenantId });
    expect(await confirmSubscription("short")).toEqual({ ok: false, error: "invalid" });
  });

  it("unsubscribes via signed link and allows re-subscribing with fresh consent", async () => {
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);
    const { token, res } = await subscribeAndGetToken(ctx.tenantId, "u@example.test");
    await confirmSubscription(token);
    const id = (res as { subscriberId: string }).subscriberId;

    expect(await unsubscribeSigned({ tenantId: ctx.tenantId, subscriberId: id, sig: "forged" })).toEqual({ ok: false, error: "invalid" });
    const sig = signUnsubscribe(ctx.tenantId, id);
    expect(await unsubscribeSigned({ tenantId: ctx.tenantId, subscriberId: id, sig })).toEqual({ ok: true, tenantId: ctx.tenantId, changed: true });
    expect(await unsubscribeSigned({ tenantId: ctx.tenantId, subscriberId: id, sig })).toEqual({ ok: true, tenantId: ctx.tenantId, changed: false });
    expect((await subscriberCounts(ctx)).unsubscribed).toBe(1);

    const again = await subscribeAndGetToken(ctx.tenantId, "u@example.test");
    const pending = await db.newsletterSubscriber.findUniqueOrThrow({ where: { id } });
    expect(pending.confirmedAt).toBeNull();
    await confirmSubscription(again.token);
    const active = await db.newsletterSubscriber.findUniqueOrThrow({ where: { id } });
    expect(active.unsubscribedAt).toBeNull();
    expect(active.confirmedAt).not.toBeNull();
  });
});

describe("public routes", () => {
  it("GET /api/newsletter/confirm redirects with the outcome", async () => {
    const { GET } = await import("@/app/api/newsletter/confirm/route");
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);
    const { token } = await subscribeAndGetToken(ctx.tenantId, "r@example.test");

    const ok = await GET(new Request(`http://shop.localhost/api/newsletter/confirm?token=${token}`));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("http://shop.localhost/newsletter?status=confirmed");
    const bad = await GET(new Request(`http://shop.localhost/api/newsletter/confirm?token=${token}`));
    expect(bad.headers.get("location")).toBe("http://shop.localhost/newsletter?status=invalid");
  });

  it("unsubscribe: GET shows a page without changing state, POST (RFC 8058 one-click) unsubscribes", async () => {
    const { GET, POST } = await import("@/app/api/newsletter/unsubscribe/route");
    const ctx = await createTenantContext();
    await addSubscribers(ctx.tenantId, 1);
    const sub = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    const url = `http://shop.localhost/api/newsletter/unsubscribe?t=${ctx.tenantId}&s=${sub.id}&sig=${signUnsubscribe(ctx.tenantId, sub.id)}`;

    const page = await GET(new Request(url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post"');
    expect((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: sub.id } })).unsubscribedAt).toBeNull();

    const oneClick = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(oneClick.status).toBe(200);
    expect((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: sub.id } })).unsubscribedAt).not.toBeNull();

    const viaPage = await POST(new Request(url, { method: "POST", body: new URLSearchParams({ via: "page" }) }));
    expect(viaPage.status).toBe(200);
    expect(await viaPage.text()).toContain("You are unsubscribed");

    const tampered = url.replace(/sig=[^&]+/, "sig=AAAAAAAAAAAAAAAAAAAAAA");
    expect((await GET(new Request(tampered))).status).toBe(400);
    expect((await POST(new Request(tampered, { method: "POST", body: "List-Unsubscribe=One-Click" }))).status).toBe(400);
  });
});

describe("campaigns", () => {
  it("CRUD on drafts, sanitized preview, audit", async () => {
    const ctx = await createTenantContext();
    const c = await createCampaign(ctx, { subject: " Spring ", body: "Hello <b>x</b> **bold**" });
    expect(c).toMatchObject({ subject: "Spring", status: "DRAFT" });
    const full = await getCampaign(ctx, c.id);
    expect(full.bodyHtml).toContain("&lt;b&gt;x&lt;/b&gt; <strong>bold</strong>");
    expect((await updateCampaign(ctx, c.id, { subject: "Summer" })).subject).toBe("Summer");
    await expect(createCampaign(ctx, { subject: "", body: "x" })).rejects.toThrow();
    await deleteCampaign(ctx, c.id);
    expect(await db.newsletterCampaign.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: { startsWith: "newsletter.campaign." } } })).toBe(3);
  });

  it("fans out in batches of 200, sends with one-click unsubscribe headers and completes", async () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("PLATFORM_HOST", "localhost:3000");
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);
    await addSubscribers(ctx.tenantId, 205);
    await addSubscribers(ctx.tenantId, 2, { confirmed: false, prefix: "pending" });
    await addSubscribers(ctx.tenantId, 1, { unsubscribed: true, prefix: "gone" });
    const c = await createCampaign(ctx, { subject: "New stock", body: "Fresh **items** in the shop." });

    const result = await sendCampaign(ctx, c.id);
    expect(result).toEqual({ recipientCount: 205, batches: 2 });
    expect(h.jobs.map((j) => [j.name, (j.data as { subscriberIds: string[] }).subscriberIds.length, j.options.inTransaction])).toEqual([
      ["newsletter.campaign.batch", 200, true],
      ["newsletter.campaign.batch", 5, true],
    ]);
    expect(await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "SENDING", recipientCount: 205 });
    await expectServiceError(sendCampaign(ctx, c.id), "CONFLICT");
    await expectServiceError(updateCampaign(ctx, c.id, { subject: "x" }), "CONFLICT");
    await expectServiceError(deleteCampaign(ctx, c.id), "CONFLICT");

    // Someone unsubscribes before their batch runs → skipped and removed from the count.
    const leaver = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: ctx.tenantId, email: "sub0@example.test" } });
    await db.newsletterSubscriber.update({ where: { id: leaver.id }, data: { unsubscribedAt: new Date() } });

    await h.drain((j) => j.name === "newsletter.campaign.batch");
    expect(h.jobs).toHaveLength(204);
    expect(h.jobs.every((j) => j.name === "mail.send" && j.options.inTransaction)).toBe(true);
    expect((await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).recipientCount).toBe(204);

    await h.drain();
    const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(campaign).toMatchObject({ status: "SENT", sentCount: 204, failedCount: 0, recipientCount: 204 });
    expect(h.mails).toHaveLength(204);
    expect(new Set(h.mails.map((m) => m.to)).has("sub0@example.test")).toBe(false);

    const mail = h.mails[0];
    expect(mail.subject).toBe("New stock");
    expect(String(mail.html)).toContain("Fresh <strong>items</strong>");
    const header = mail.headers!["List-Unsubscribe"];
    expect(header).toMatch(/^<http:\/\/localhost:3000\/api\/newsletter\/unsubscribe\?t=.+&s=.+&sig=.+>$/);
    expect(mail.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const unsub = new URL(header.slice(1, -1));
    const target = await db.newsletterSubscriber.findFirstOrThrow({ where: { email: String(mail.to) } });
    expect(unsub.searchParams.get("s")).toBe(target.id);
    expect(linkIn(mail, "/api/newsletter/unsubscribe").toString()).toBe(unsub.toString());
    expect(
      await unsubscribeSigned({ tenantId: unsub.searchParams.get("t")!, subscriberId: unsub.searchParams.get("s")!, sig: unsub.searchParams.get("sig")! }),
    ).toMatchObject({ ok: true, changed: true });
  });

  it("counts failures on the final attempt and marks an undeliverable campaign FAILED", async () => {
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId);
    await addSubscribers(ctx.tenantId, 2);
    const c = await createCampaign(ctx, { subject: "S", body: "B" });
    await sendCampaign(ctx, c.id);
    await h.drain((j) => j.name === "newsletter.campaign.batch");
    setMailSinkForTests(() => {
      throw new Error("SMTP down");
    });
    const [first, second] = h.jobs.splice(0);
    await expect(runJobNow("mail.send", first.data, { retryCount: 0, retryLimit: 5 })).rejects.toThrow("SMTP down");
    expect((await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).failedCount).toBe(0); // will retry
    await expect(runJobNow("mail.send", first.data, { retryCount: 5, retryLimit: 5 })).rejects.toThrow();
    await expect(runJobNow("mail.send", second.data, { retryCount: 5, retryLimit: 5 })).rejects.toThrow();
    expect(await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "FAILED", failedCount: 2, sentCount: 0 });
  });

  it("enforces the monthly quota (sum of recipients of campaigns sent this month)", async () => {
    const ctx = await createTenantContext();
    await enableNewsletter(ctx.tenantId, 300);
    await addSubscribers(ctx.tenantId, 150);
    // Last month's campaign doesn't count, this month's does.
    await db.newsletterCampaign.createMany({
      data: [
        { tenantId: ctx.tenantId, subject: "old", body: "x", status: "SENT", sentAt: new Date(Date.now() - 62 * 86400_000), recipientCount: 1000 },
        { tenantId: ctx.tenantId, subject: "recent", body: "x", status: "SENT", sentAt: new Date(), recipientCount: 100 },
      ],
    });
    expect(await getNewsletterQuota(ctx)).toMatchObject({ quota: 300, used: 100, remaining: 200 });
    const c1 = await createCampaign(ctx, { subject: "a", body: "x" });
    await sendCampaign(ctx, c1.id); // 100 + 150 = 250 ≤ 300
    const c2 = await createCampaign(ctx, { subject: "b", body: "x" });
    await expect(sendCampaign(ctx, c2.id)).rejects.toMatchObject({ code: "CONFLICT", details: { ok: false, remaining: 50, needed: 150 } });
    expect((await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c2.id } })).status).toBe("DRAFT");

    await enableNewsletter(ctx.tenantId, -1);
    await expect(sendCampaign(ctx, c2.id)).resolves.toMatchObject({ recipientCount: 150 });
  });

  it("refuses to send without subscribers or when disabled; test sends go to one address", async () => {
    const ctx = await createTenantContext();
    const c = await createCampaign(ctx, { subject: "Hello", body: "Body" });
    await expectServiceError(sendCampaign(ctx, c.id), "UNAVAILABLE");
    await enableNewsletter(ctx.tenantId);
    await expectServiceError(sendCampaign(ctx, c.id), "INVALID");

    await sendTestCampaign(ctx, c.id, "Owner@Example.test");
    await h.drain();
    expect(h.mails).toHaveLength(1);
    expect(h.mails[0]).toMatchObject({ to: "owner@example.test", subject: "[Test] Hello" });
    expect(h.mails[0].headers?.["List-Unsubscribe"]).toBeUndefined();
    expect((await db.newsletterCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DRAFT");
    await expectServiceError(sendTestCampaign(ctx, c.id, "nope"), "INVALID");
  });
});

describe("admin subscriber list", () => {
  it("filters, pages, searches and exports", async () => {
    const ctx = await createTenantContext();
    await addSubscribers(ctx.tenantId, 3);
    await addSubscribers(ctx.tenantId, 2, { confirmed: false, prefix: "pending" });
    await addSubscribers(ctx.tenantId, 1, { unsubscribed: true, prefix: "gone" });

    expect(await subscriberCounts(ctx)).toEqual({ active: 3, pending: 2, unsubscribed: 1, total: 6 });
    const page = await listSubscribers(ctx, { status: "active", pageSize: 2 });
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0].status).toBe("active");
    expect((await listSubscribers(ctx, { status: "all", search: "PENDING" })).total).toBe(2);

    const csv = await exportSubscribersCsv(ctx, { status: "all" });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,status,source,subscribed_at,confirmed_at,unsubscribed_at");
    expect(lines).toHaveLength(7);
    expect(csv).toContain("gone0@example.test,unsubscribed,");
    expect(await db.auditLog.count({ where: { action: "newsletter.subscribers.exported" } })).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("never lets one tenant see or touch another tenant's newsletter data", async () => {
    const a = await createTenantContext();
    const b: ServiceContext = await createTenantContext();
    await enableNewsletter(a.tenantId);
    await enableNewsletter(b.tenantId);
    await addSubscribers(a.tenantId, 3);
    const campaign = await createCampaign(a, { subject: "A only", body: "x" });
    const subA = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: a.tenantId } });

    await expectServiceError(getCampaign(b, campaign.id), "NOT_FOUND");
    await expectServiceError(updateCampaign(b, campaign.id, { subject: "hijack" }), "NOT_FOUND");
    await expectServiceError(deleteCampaign(b, campaign.id), "NOT_FOUND");
    await expectServiceError(sendCampaign(b, campaign.id), "NOT_FOUND");
    await expectServiceError(sendTestCampaign(b, campaign.id, "x@example.test"), "NOT_FOUND");
    expect((await listSubscribers(b, { status: "all" })).total).toBe(0);
    expect(await exportSubscribersCsv(b, { status: "all" })).not.toContain("@example.test");
    expect(await deleteSubscribers(b, [subA.id])).toBe(0);

    // A valid signature for tenant B doesn't unsubscribe tenant A's subscriber.
    const sigB = signUnsubscribe(b.tenantId, subA.id);
    expect(await unsubscribeSigned({ tenantId: b.tenantId, subscriberId: subA.id, sig: sigB })).toMatchObject({ ok: true, changed: false });
    expect(await unsubscribeSigned({ tenantId: a.tenantId, subscriberId: subA.id, sig: sigB })).toEqual({ ok: false, error: "invalid" });
    expect((await db.newsletterSubscriber.findUniqueOrThrow({ where: { id: subA.id } })).unsubscribedAt).toBeNull();

    // Same email in two shops = two independent subscriptions; a batch for A ignores B's ids.
    await addSubscribers(b.tenantId, 1);
    const subB = await db.newsletterSubscriber.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    expect(subB.email).toBe(subA.email);
    await sendCampaign(a, campaign.id);
    const batch = h.jobs[0].data as { tenantId: string; campaignId: string; subscriberIds: string[] };
    h.jobs.length = 0;
    await runJobNow("newsletter.campaign.batch", { ...batch, subscriberIds: [subB.id] });
    expect(h.jobs).toHaveLength(0);
    // A confirmation token only works on its own shop's host.
    const { token } = await subscribeAndGetToken(b.tenantId, "only-b@example.test");
    expect(await confirmSubscription(token, { tenantId: a.tenantId })).toEqual({ ok: false, error: "invalid" });
    expect(await confirmSubscription(token, { tenantId: b.tenantId })).toMatchObject({ ok: true });
  });
});
