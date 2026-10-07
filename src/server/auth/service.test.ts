import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── In-memory fakes for the DB, session cookie layer, audit and rate limiting ──

type User = {
  id: string;
  tenantId: string | null;
  role: "SUPERADMIN" | "OWNER" | "CUSTOMER";
  email: string;
  name: string | null;
  passwordHash: string | null;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
};
type RecoveryCode = { id: string; userId: string; codeHash: string; usedAt: Date | null };
type AuthToken = { id: string; userId: string; type: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };

const state = vi.hoisted(() => ({
  users: [] as User[],
  recoveryCodes: [] as RecoveryCode[],
  authTokens: [] as AuthToken[],
  hits: new Map<string, { id: number; at: number }[]>(),
  audits: [] as { action: string; actorId?: string | null; data?: unknown }[],
  session: null as null | { sessionId: string; pendingTotp: boolean; user: { id: string; tenantId: string | null; role: User["role"]; email: string; name: string | null; totpEnabled: boolean } },
  seq: 0,
}));

const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && "in" in v ? (v as { in: unknown[] }).in.includes(row[k]) : row[k] === v,
  );

vi.mock("@/server/db", () => {
  const id = () => `id${++state.seq}`;
  const db = {
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.users.find((u) => matches(u, where)) ?? null,
      findUnique: async ({ where }: { where: { id?: string; tenantId_email?: { tenantId: string; email: string } } }) =>
        state.users.find((u) =>
          where.id ? u.id === where.id : u.tenantId === where.tenantId_email!.tenantId && u.email === where.tenantId_email!.email,
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const u = state.users.find((x) => x.id === where.id)!;
        Object.assign(u, data);
        return u;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<User> }) => {
        const rows = state.users.filter((u) => matches(u, where));
        rows.forEach((u) => Object.assign(u, data));
        return { count: rows.length };
      },
    },
    recoveryCode: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.recoveryCodes.find((r) => matches(r, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<RecoveryCode> }) => {
        const rows = state.recoveryCodes.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        state.recoveryCodes = state.recoveryCodes.filter((r) => r.userId !== where.userId);
        return { count: 0 };
      },
      createMany: async ({ data }: { data: { userId: string; codeHash: string }[] }) => {
        data.forEach((d) => state.recoveryCodes.push({ id: id(), usedAt: null, ...d }));
        return { count: data.length };
      },
    },
    authToken: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<AuthToken> }) => {
        const rows = state.authTokens.filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      create: async ({ data }: { data: Omit<AuthToken, "id" | "usedAt"> }) => {
        const row = { id: id(), usedAt: null, ...data };
        state.authTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = state.authTokens.find((t) => t.tokenHash === where.tokenHash);
        return row ? { ...row, user: state.users.find((u) => u.id === row.userId)! } : null;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return { db };
});

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (entry: { action: string }) => void state.audits.push(entry)),
}));

// In-memory rate limiter with the real policies and backoff formula (atomicity is covered by
// tests/integration/rate-limit.int.test.ts against Postgres).
vi.mock("./rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("./rate-limit")>();
  let seq = 0;
  const list = (key: string) => state.hits.get(key) ?? [];
  const inWindow = (key: string, windowMs: number) => list(key).filter((h) => h.at >= Date.now() - windowMs);
  const record = (key: string) => {
    const h = { id: ++seq, at: Date.now() };
    state.hits.set(key, [...list(key), h]);
    return { allowed: true as const, hitId: BigInt(h.id) };
  };
  return {
    RULES: real.RULES,
    BACKOFF: real.BACKOFF,
    backoffDelayMs: real.backoffDelayMs,
    consume: async (key: string, rule: { limit: number; windowMs: number }) =>
      inWindow(key, rule.windowMs).length >= rule.limit ? { allowed: false, retryAfterMs: 1000 } : record(key),
    take: async (key: string, rule: { limit: number; windowMs: number }) =>
      inWindow(key, rule.windowMs).length >= rule.limit ? false : (record(key), true),
    attempt: async (key: string, policy: Parameters<typeof real.backoffDelayMs>[1]) => {
      const hits = inWindow(key, policy.windowMs);
      const delay = real.backoffDelayMs(hits.length, policy);
      const last = hits.at(-1)?.at;
      if (delay > 0 && last !== undefined && Date.now() - last < delay) return { allowed: false, retryAfterMs: delay - (Date.now() - last) };
      return record(key);
    },
    release: async (d: { allowed: boolean; hitId?: bigint } | null | undefined) => {
      if (!d?.allowed) return;
      for (const [k, v] of state.hits) state.hits.set(k, v.filter((h) => BigInt(h.id) !== d.hitId));
    },
    clear: async (key: string) => void state.hits.delete(key),
  };
});

vi.mock("./session", () => ({
  createSession: vi.fn(async (userId: string, role: User["role"], opts: { pendingTotp?: boolean } = {}) => {
    const u = state.users.find((x) => x.id === userId)!;
    state.session = {
      sessionId: `s${++state.seq}`,
      pendingTotp: opts.pendingTotp ?? false,
      user: { id: u.id, tenantId: u.tenantId, role, email: u.email, name: u.name, totpEnabled: u.totpEnabledAt !== null },
    };
  }),
  getSession: vi.fn(async () => state.session),
  promoteSession: vi.fn(async () => {
    if (state.session) state.session.pendingTotp = false;
  }),
  destroySession: vi.fn(async () => {
    state.session = null;
  }),
  destroyAllSessions: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("outside request scope");
  },
}));

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const service = await import("./service");
const session = await import("./session");
const { hashPassword, verifyPassword } = await import("./password");
const { totp } = await import("./totp");
const { encrypt } = await import("./encryption");

const PASSWORD = "correct horse battery";
let passwordHash: string;

function addUser(partial: Partial<User> = {}): User {
  const u: User = {
    id: `u${++state.seq}`,
    tenantId: "t1",
    role: "OWNER",
    email: "owner@example.nl",
    name: null,
    passwordHash,
    totpSecretEnc: null,
    totpEnabledAt: null,
    disabledAt: null,
    lastLoginAt: null,
    ...partial,
  };
  state.users.push(u);
  return u;
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  state.users = [];
  state.recoveryCodes = [];
  state.authTokens = [];
  state.hits.clear();
  state.audits = [];
  state.session = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("login", () => {
  it("signs in a tenant owner with a normalized email", async () => {
    const u = addUser();
    const res = await service.login({ email: "  Owner@Example.NL ", password: PASSWORD, tenantId: "t1", ip: "1.2.3.4" });
    expect(res).toEqual({ ok: true, next: "done" });
    expect(session.createSession).toHaveBeenCalledWith(u.id, "OWNER", { pendingTotp: false });
    expect(u.lastLoginAt).toBeInstanceOf(Date);
    expect(state.audits.map((a) => a.action)).toContain("auth.login");
  });

  it("does not let a tenant user sign in on another tenant or the platform host", async () => {
    addUser();
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t2", ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: null, ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
    expect(session.createSession).not.toHaveBeenCalled();
  });

  it("only accepts SUPERADMINs on the platform host", async () => {
    const admin = addUser({ tenantId: null, role: "SUPERADMIN", email: "root@example.nl" });
    expect(await service.login({ email: "root@example.nl", password: PASSWORD, tenantId: null, ip: null })).toEqual({ ok: true, next: "done" });
    expect(session.createSession).toHaveBeenCalledWith(admin.id, "SUPERADMIN", { pendingTotp: false });
  });

  it("returns the same error for a wrong password and an unknown user", async () => {
    addUser();
    const wrong = await service.login({ email: "owner@example.nl", password: "nope nope nope", tenantId: "t1", ip: null });
    const unknown = await service.login({ email: "ghost@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(wrong).toEqual({ ok: false, error: "invalid_credentials" });
    expect(unknown).toEqual(wrong);
    expect(state.audits.filter((a) => a.action === "auth.login_failed")).toHaveLength(2);
  });

  it("treats a user without a password as invalid credentials", async () => {
    addUser({ passwordHash: null });
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("backs off per account after 5 failures — no hard lock-out — and clears the counter on success", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    addUser();
    for (let i = 0; i < 4; i++) await service.login({ email: "owner@example.nl", password: "wrong password", tenantId: "t1", ip: `10.0.0.${i}` });
    expect((await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: "10.0.1.1" })).ok).toBe(true);
    expect(state.hits.get("login:email:t1:owner@example.nl")).toBeUndefined();

    for (let i = 0; i < 5; i++) await service.login({ email: "owner@example.nl", password: "wrong password", tenantId: "t1", ip: `10.0.0.${i}` });
    // 6th attempt right away: must wait (1 s after 5 failures) — even with the right password.
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: "10.0.2.1" })).toEqual({ ok: false, error: "rate_limited" });
    // A refused attempt is not counted, and after the delay the real owner gets in.
    expect(state.hits.get("login:email:t1:owner@example.nl")).toHaveLength(5);
    vi.setSystemTime(1_800_000_001_001);
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: "10.0.2.1" })).toEqual({ ok: true, next: "done" });
  });

  it("delays grow exponentially and are capped", async () => {
    const { BACKOFF, backoffDelayMs } = await import("./rate-limit");
    const p = BACKOFF.loginPerAccount;
    expect([4, 5, 6, 7].map((n) => backoffDelayMs(n, p))).toEqual([0, 1000, 2000, 4000]);
    expect(backoffDelayMs(50, p)).toBe(p.maxMs);
  });

  it("backs off unknown accounts exactly like real ones (no enumeration)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    addUser();
    const run = async (email: string) => {
      const out = [];
      for (let i = 0; i < 6; i++) out.push(await service.login({ email, password: "wrong password", tenantId: "t1", ip: null }));
      return out;
    };
    expect(await run("ghost@example.nl")).toEqual(await run("owner@example.nl"));
  });

  it("rate limits per IP and does not count the refused attempt against the account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    state.hits.set("login:ip:9.9.9.9", Array.from({ length: 21 }, (_, i) => ({ id: 1000 + i, at: Date.now() - 10 })));
    addUser();
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: "9.9.9.9" })).toEqual({ ok: false, error: "rate_limited" });
    expect(state.hits.get("login:email:t1:owner@example.nl") ?? []).toHaveLength(0);
  });

  it("does not count successful logins against the IP", async () => {
    addUser();
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: "9.9.9.8" });
    expect(state.hits.get("login:ip:9.9.9.8") ?? []).toHaveLength(0);
  });

  it("rejects disabled users only after a correct password", async () => {
    addUser({ disabledAt: new Date() });
    expect(await service.login({ email: "owner@example.nl", password: "wrong password", tenantId: "t1", ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null })).toEqual({ ok: false, error: "disabled" });
    expect(session.createSession).not.toHaveBeenCalled();
  });

  it("creates a pending session when TOTP is enabled", async () => {
    const u = addUser({ totpSecretEnc: encrypt("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"), totpEnabledAt: new Date() });
    expect(await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null })).toEqual({ ok: true, next: "totp" });
    expect(session.createSession).toHaveBeenCalledWith(u.id, "OWNER", { pendingTotp: true });
    expect(u.lastLoginAt).toBeNull();
  });

  it("rehashes passwords stored with weaker parameters", async () => {
    const { scryptSync } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD, salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const u = addUser({ passwordHash: ["scrypt", 2 ** 14, 8, 1, salt.toString("base64"), key.toString("base64")].join("$") });
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(u.passwordHash!.startsWith("scrypt$32768$")).toBe(true);
    expect(await verifyPassword(PASSWORD, u.passwordHash!)).toBe(true);
  });

  // PHP 8.4.16: crypt("hunter2-legacy", '$2y$04$abcdefghijklmnopqrstuu') — see legacy-bcrypt.test.ts.
  const LEGACY = "bcrypt$$2y$04$abcdefghijklmnopqrstuuYQzyYpuBlD9anKNO5exwCD0BATGyB9S";

  it("accepts a legacy bcrypt hash once and replaces it with scrypt", async () => {
    const u = addUser({ passwordHash: LEGACY });
    expect(await service.login({ email: "owner@example.nl", password: "hunter2-legacy!", tenantId: "t1", ip: null })).toEqual({ ok: false, error: "invalid_credentials" });
    expect(u.passwordHash).toBe(LEGACY);
    expect(await service.login({ email: "owner@example.nl", password: "hunter2-legacy", tenantId: "t1", ip: null })).toEqual({ ok: true, next: "done" });
    expect(u.passwordHash!.startsWith("scrypt$32768$")).toBe(true);
    expect(await verifyPassword("hunter2-legacy", u.passwordHash!)).toBe(true);
    expect(state.audits.map((a) => a.action)).toContain("auth.password_rehashed");
  });

  it("rehashes a legacy hash on re-authentication too", async () => {
    const u = addUser({ passwordHash: LEGACY });
    expect(await service.verifyCurrentPassword(u.id, "hunter2-legacy")).toBe("ok");
    expect(u.passwordHash!.startsWith("scrypt$")).toBe(true);
  });
});

describe("TOTP enrollment and login", () => {
  async function enroll() {
    const u = addUser();
    const su = { id: u.id, tenantId: u.tenantId, role: u.role, email: u.email };
    const { secret, uri } = service.startTotpEnrollment(su);
    expect(uri).toContain(`secret=${secret}`);
    expect(u.totpSecretEnc).toBeNull();
    const res = await service.confirmTotpEnrollment(su, secret, totp(secret));
    if (!res.ok) throw new Error(res.error);
    return { u, su, secret, recoveryCodes: res.recoveryCodes };
  }

  it("rejects a wrong confirmation code and stores nothing", async () => {
    const u = addUser();
    const su = { id: u.id, tenantId: u.tenantId, role: u.role, email: u.email };
    const { secret } = service.startTotpEnrollment(su);
    expect(await service.confirmTotpEnrollment(su, secret, "000000")).toMatchObject({ ok: false });
    expect(await service.confirmTotpEnrollment(su, "not-a-secret", totp(secret))).toEqual({ ok: false, error: "invalid_secret" });
    expect(u.totpEnabledAt).toBeNull();
  });

  it("stores an encrypted secret and 10 hashed recovery codes", async () => {
    const { u, secret, recoveryCodes } = await enroll();
    expect(u.totpEnabledAt).toBeInstanceOf(Date);
    expect(u.totpSecretEnc).toMatch(/^v1\./);
    expect(u.totpSecretEnc).not.toContain(secret);
    expect(recoveryCodes).toHaveLength(10);
    expect(state.recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/);
    expect(state.recoveryCodes.every((r) => /^h1:[0-9a-f]{64}$/.test(r.codeHash))).toBe(true);
    expect(state.recoveryCodes.map((r) => r.codeHash).join()).not.toContain(recoveryCodes[0]);
  });

  it("refuses to enroll twice", async () => {
    const { su } = await enroll();
    const { secret } = service.startTotpEnrollment(su);
    expect(await service.confirmTotpEnrollment(su, secret, totp(secret))).toEqual({ ok: false, error: "already_enabled" });
  });

  it("completes a pending login with a TOTP code and rejects replay of the same code", async () => {
    // Freeze the clock mid-step so enrollment and login use the same TOTP step.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_015_000);
    const { secret } = await enroll();
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(state.session?.pendingTotp).toBe(true);

    // The enrollment code was already used for this step; a fresh login must not accept it again.
    const replay = await service.verifyLoginTotp(totp(secret));
    expect(replay).toEqual({ ok: false, error: "invalid_code" });

    for (const k of [...state.hits.keys()]) if (k.startsWith("totp:used:")) state.hits.delete(k); // pretend 30 s passed
    expect(await service.verifyLoginTotp(totp(secret))).toEqual({ ok: true, usedRecoveryCode: false });
    expect(session.promoteSession).toHaveBeenCalled();
    expect(state.session?.pendingTotp).toBe(false);
    vi.useRealTimers();
  });

  it("accepts a recovery code exactly once", async () => {
    const { recoveryCodes } = await enroll();
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(await service.verifyLoginTotp(recoveryCodes[0].toUpperCase().replace("-", " "))).toEqual({ ok: true, usedRecoveryCode: true });

    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(await service.verifyLoginTotp(recoveryCodes[0])).toEqual({ ok: false, error: "invalid_code" });
  });

  it("still accepts a legacy (SHA-256, 10-char) recovery code once", async () => {
    const { u } = await enroll();
    const { hashToken } = await import("./tokens");
    state.recoveryCodes.push({ id: "legacy", userId: u.id, codeHash: hashToken("abcde-fghjk"), usedAt: null });
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(await service.verifyLoginTotp("ABCDE FGHJK")).toEqual({ ok: true, usedRecoveryCode: true });
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    expect(await service.verifyLoginTotp("abcde-fghjk")).toEqual({ ok: false, error: "invalid_code" });
  });

  it("kills the pending session after too many wrong codes", async () => {
    await enroll();
    await service.login({ email: "owner@example.nl", password: PASSWORD, tenantId: "t1", ip: null });
    for (let i = 0; i < 5; i++) expect(await service.verifyLoginTotp("000000")).toMatchObject({ ok: false });
    expect(await service.verifyLoginTotp("000000")).toEqual({ ok: false, error: "rate_limited" });
    expect(state.session).toBeNull();
  });

  it("requires a pending session", async () => {
    expect(await service.verifyLoginTotp("123456")).toEqual({ ok: false, error: "no_pending_session" });
  });

  it("disables TOTP only with the correct password", async () => {
    const { u, su } = await enroll();
    expect(await service.disableTotp(su, "wrong password")).toEqual({ ok: false, error: "invalid_password" });
    expect(u.totpEnabledAt).not.toBeNull();
    expect(await service.disableTotp(su, PASSWORD)).toEqual({ ok: true });
    expect(session.destroyAllSessions).toHaveBeenCalledWith(u.id, undefined); // other devices signed out
    expect(u.totpEnabledAt).toBeNull();
    expect(u.totpSecretEnc).toBeNull();
    expect(state.recoveryCodes).toHaveLength(0);
  });
});

describe("password reset", () => {
  it("returns null for unknown users and a token for known ones", async () => {
    addUser();
    expect(await service.requestPasswordReset("t1", "ghost@example.nl")).toBeNull();
    expect(await service.requestPasswordReset("t2", "owner@example.nl")).toBeNull();
    const token = await service.requestPasswordReset("t1", "OWNER@example.nl");
    expect(token).toEqual(expect.any(String));
    expect(state.authTokens[0].tokenHash).not.toBe(token);
  });

  it("is rate limited per email", async () => {
    addUser();
    for (let i = 0; i < 3; i++) expect(await service.requestPasswordReset("t1", "owner@example.nl")).not.toBeNull();
    expect(await service.requestPasswordReset("t1", "owner@example.nl")).toBeNull();
  });

  it("invalidates older tokens when a new one is requested", async () => {
    addUser();
    const first = (await service.requestPasswordReset("t1", "owner@example.nl"))!;
    const second = (await service.requestPasswordReset("t1", "owner@example.nl"))!;
    expect(await service.resetPassword(first, "a brand new password")).toEqual({ ok: false, error: "invalid_token" });
    expect(await service.resetPassword(second, "a brand new password")).toEqual({ ok: true });
  });

  it("resets the password once, signs out everywhere and rejects reuse", async () => {
    const u = addUser();
    const token = (await service.requestPasswordReset("t1", "owner@example.nl"))!;
    expect(await service.resetPassword(token, "short")).toMatchObject({ ok: false, error: "invalid_password" });
    expect(await service.resetPassword(token, "a brand new password")).toEqual({ ok: true });
    expect(await verifyPassword("a brand new password", u.passwordHash!)).toBe(true);
    expect(session.destroyAllSessions).toHaveBeenCalledWith(u.id);
    expect(await service.resetPassword(token, "another new password")).toEqual({ ok: false, error: "invalid_token" });
  });

  it("rejects expired tokens", async () => {
    addUser();
    const token = (await service.requestPasswordReset("t1", "owner@example.nl"))!;
    state.authTokens[0].expiresAt = new Date(Date.now() - 1);
    expect(await service.resetPassword(token, "a brand new password")).toEqual({ ok: false, error: "invalid_token" });
  });
});

describe("changePassword", () => {
  it("requires the current password and keeps the current session", async () => {
    const u = addUser();
    const su = { id: u.id, tenantId: u.tenantId, role: u.role, email: u.email };
    expect(await service.changePassword(su, "wrong password", "a brand new password")).toEqual({ ok: false, error: "invalid_current_password" });
    expect(await service.changePassword(su, PASSWORD, "short")).toMatchObject({ ok: false, error: "invalid_password" });
    expect(await service.changePassword(su, PASSWORD, "a brand new password", "s-current")).toEqual({ ok: true });
    expect(await verifyPassword("a brand new password", u.passwordHash!)).toBe(true);
    expect(session.destroyAllSessions).toHaveBeenCalledWith(u.id, "s-current");
  });
});
