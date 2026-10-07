import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

/*
 * Read-only tenant basics (name, currency, time zone, primary host) for the system screens.
 * No tenant service exposes this to OWNER contexts yet (platform `getTenant` is SUPERADMIN-only),
 * so this is a small local read. Always pass `ctx.tenantId` from requireStaffContext().
 */
export type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  primaryHost: string | null;
};

export const getTenantInfo = cache(async (tenantId: string): Promise<TenantInfo> => {
  const t = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      currency: true,
      timezone: true,
      domains: { where: { isPrimary: true }, select: { host: true }, take: 1 },
    },
  });
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    currency: t.currency,
    timezone: t.timezone,
    primaryHost: t.domains[0]?.host ?? null,
  };
});

/**
 * Link an invited owner opens to choose a password. The token is redeemed with auth `resetPassword()`.
 * The page is `/admin/reset-password` (auth screens), served on the tenant's primary host.
 */
export function inviteLink(host: string | null, token: string): string {
  const path = `/admin/reset-password?token=${encodeURIComponent(token)}`;
  if (!host) return path;
  const scheme = host.startsWith("localhost") || host.endsWith(".localhost") || host.endsWith(".test") ? "http" : "https";
  return `${scheme}://${host}${path}`;
}
