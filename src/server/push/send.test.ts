import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * sendPushMessage() with a mocked web-push and an in-memory stand-in for the two Prisma models it
 * touches: quiet hours / cap bookkeeping, 404/410 cleanup and retry on transient failures.
 */

const sendNotification = vi.fn();
vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  return { default: { sendNotification: (...a: unknown[]) => sendNotification(...a) }, WebPushError };
});

type Msg = {
  id: string;
  tenantId: string;
  customerId: string;
  kind: "SAVED_SEARCH" | "PRICE_DROP" | "RESERVATION_ENDING" | "BACK_AVAILABLE";
  title: string;
  body: string;
  url: string;
  queuedFor: Date | null;
  sentAt: Date | null;
  createdAt: Date;
};
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; lastUsedAt?: Date };

const state = {
  msg: null as Msg | null,
  subs: [] as Sub[],
  sentToday: 0,
  customer: { pushQuietStart: null as number | null, pushQuietEnd: null as number | null, pushMaxPerDay: 5 },
};

vi.mock("@/server/db", () => ({
  db: {
    pushMessage: {
      findUnique: async () => (state.msg ? { ...state.msg, tenant: { timezone: "Europe/Amsterdam", status: "ACTIVE" }, customer: state.customer } : null),
      deleteMany: async () => {
        const had = !!state.msg && !state.msg.sentAt;
        if (had) state.msg = null;
        return { count: had ? 1 : 0 };
      },
      count: async () => state.sentToday,
      updateMany: async ({ where, data }: { where: { sentAt?: null }; data: Partial<Msg> }) => {
        if (!state.msg || (where.sentAt === null && state.msg.sentAt)) return { count: 0 };
        Object.assign(state.msg, data);
        return { count: 1 };
      },
    },
    pushSubscription: {
      findMany: async () => state.subs,
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        state.subs = state.subs.filter((s) => !where.id.in.includes(s.id));
        return { count: 1 };
      },
      updateMany: async () => ({ count: 1 }),
    },
  },
}));
vi.mock("@/server/jobs/queue", () => ({ enqueue: vi.fn() }));

const { sendPushMessage } = await import("./send");
const { WebPushError } = await import("web-push");

const NOON = new Date("2026-10-09T10:00:00Z"); // 12:00 Amsterdam

function message(over: Partial<Msg> = {}): Msg {
  return {
    id: "m1",
    tenantId: "t1",
    customerId: "c1",
    kind: "SAVED_SEARCH",
    title: "New: Stahlhelm",
    body: "Matches your search",
    url: "/product/1/helm",
    queuedFor: null,
    sentAt: null,
    createdAt: new Date(NOON.getTime() - 1000),
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
  vi.stubEnv("VAPID_PRIVATE_KEY", "privateKeyForTests");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
  state.msg = message();
  state.subs = [
    { id: "s1", endpoint: "https://push.example/1", p256dh: "p", auth: "a" },
    { id: "s2", endpoint: "https://push.example/2", p256dh: "p", auth: "a" },
  ];
  state.sentToday = 0;
  state.customer = { pushQuietStart: null, pushQuietEnd: null, pushMaxPerDay: 5 };
});
afterEach(() => vi.unstubAllEnvs());

describe("sendPushMessage", () => {
  it("sends to every device and records sentAt", async () => {
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "sent", delivered: 2, removed: 0 });
    expect(state.msg?.sentAt).toEqual(NOON);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [sub, payload, opts] = sendNotification.mock.calls[0];
    expect(sub).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } });
    expect(JSON.parse(payload)).toMatchObject({ title: "New: Stahlhelm", url: "/product/1/helm", icon: "/pwa-icon/192" });
    expect(opts).toMatchObject({ urgency: "normal", TTL: 6 * 3600, vapidDetails: { subject: "mailto:test@example.com" } });
  });

  it("is idempotent (already sent)", async () => {
    state.msg = message({ sentAt: NOON });
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "skipped" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("removes subscriptions the push service reports gone (404/410)", async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/2")) throw new WebPushError("gone", 410, {}, "", sub.endpoint);
      return { statusCode: 201 };
    });
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "sent", delivered: 1, removed: 1 });
    expect(state.subs.map((s) => s.id)).toEqual(["s1"]);
  });

  it("unclaims and throws on transient failures (job retry)", async () => {
    sendNotification.mockRejectedValue(new WebPushError("busy", 503, {}, "", ""));
    await expect(sendPushMessage("m1", NOON)).rejects.toThrow("busy");
    expect(state.msg?.sentAt).toBeNull();
  });

  it("defers in quiet hours, and to tomorrow over the daily cap", async () => {
    state.customer = { pushQuietStart: 22 * 60, pushQuietEnd: 8 * 60, pushMaxPerDay: 5 };
    const night = new Date("2026-10-09T21:00:00Z");
    expect(await sendPushMessage("m1", night)).toMatchObject({ status: "deferred", reason: "quiet" });
    expect(state.msg?.queuedFor).toEqual(new Date("2026-10-10T06:00:00Z"));
    expect(sendNotification).not.toHaveBeenCalled();

    state.msg = message();
    state.sentToday = 5;
    expect(await sendPushMessage("m1", NOON)).toMatchObject({ status: "deferred", reason: "cap" });
  });

  it("waits while queuedFor is in the future", async () => {
    state.msg = message({ queuedFor: new Date(NOON.getTime() + 60_000) });
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "skipped" });
  });

  it("drops a reservation warning in quiet hours; sends it urgently otherwise, uncapped", async () => {
    state.customer = { pushQuietStart: 22 * 60, pushQuietEnd: 8 * 60, pushMaxPerDay: 1 };
    state.msg = message({ kind: "RESERVATION_ENDING", url: "/cart" });
    expect(await sendPushMessage("m1", new Date("2026-10-09T21:00:00Z"))).toEqual({ status: "dropped", reason: "quiet" });
    expect(state.msg).toBeNull();

    state.msg = message({ kind: "RESERVATION_ENDING", url: "/cart" });
    state.sentToday = 10;
    expect(await sendPushMessage("m1", NOON)).toMatchObject({ status: "sent" });
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ urgency: "high" });
  });

  it("drops when there is no device or push is not configured", async () => {
    state.subs = [];
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "dropped", reason: "no-devices" });

    state.msg = message();
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(await sendPushMessage("m1", NOON)).toEqual({ status: "dropped", reason: "disabled" });
  });
});
