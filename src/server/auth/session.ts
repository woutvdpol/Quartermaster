import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import type { Role } from "@/generated/prisma/enums";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "qm_session";

const HOUR = 60 * 60 * 1000;
// Staff sessions are short; customers stay signed in longer. Both slide on activity.
const LIFETIME: Record<Role, number> = {
  SUPERADMIN: 12 * HOUR,
  OWNER: 12 * HOUR,
  CUSTOMER: 30 * 24 * HOUR,
};
// A session awaiting its TOTP code is only valid briefly.
const PENDING_TOTP_LIFETIME = 10 * 60 * 1000;
// Avoid a DB write on every request: only touch the session when it is this stale.
const TOUCH_AFTER = 15 * 60 * 1000;

export type SessionUser = {
  id: string;
  tenantId: string | null;
  role: Role;
  email: string;
  name: string | null;
  totpEnabled: boolean;
};

export type ValidSession = { sessionId: string; pendingTotp: boolean; user: SessionUser };

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}

async function setCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function createSession(userId: string, role: Role, opts: { pendingTotp?: boolean } = {}) {
  const token = generateToken();
  const pendingTotp = opts.pendingTotp ?? false;
  const expiresAt = new Date(Date.now() + (pendingTotp ? PENDING_TOTP_LIFETIME : LIFETIME[role]));
  const meta = await requestMeta();
  const session = await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, pendingTotp, ...meta },
  });
  await setCookie(token, expiresAt);
  return session;
}

/** Reads and validates the session cookie. Does not enforce roles or tenants — see guards.ts. */
export async function getSession(): Promise<ValidSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    // Only the columns the session needs — never pull password/TOTP secrets into every request.
    include: {
      user: {
        select: { id: true, tenantId: true, role: true, email: true, name: true, totpEnabledAt: true, disabledAt: true },
      },
    },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.user.disabledAt) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (!session.pendingTotp && now - session.lastSeenAt.getTime() > TOUCH_AFTER) {
    const expiresAt = new Date(now + LIFETIME[session.user.role]);
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt } });
    // Cookies can only be written in Server Actions / Route Handlers; ignore elsewhere.
    await setCookie(token, expiresAt).catch(() => {});
  }

  const { user } = session;
  return {
    sessionId: session.id,
    pendingTotp: session.pendingTotp,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      totpEnabled: user.totpEnabledAt !== null,
    },
  };
}

/** Completes a pending-TOTP session after the code was verified. Rotates the token. */
export async function promoteSession(sessionId: string, role: Role) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + LIFETIME[role]);
  await db.session.update({
    where: { id: sessionId },
    data: { tokenHash: hashToken(token), pendingTotp: false, expiresAt, lastSeenAt: new Date() },
  });
  await setCookie(token, expiresAt);
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}

/** Signs a user out everywhere, e.g. after a password change. */
export async function destroyAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}
