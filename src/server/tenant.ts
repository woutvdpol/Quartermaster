import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/server/db";

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  return host.trim().toLowerCase().replace(/\.$/, "") || null;
}

export function isPlatformHost(host: string | null): boolean {
  const platform = normalizeHost(process.env.PLATFORM_HOST);
  return host !== null && platform !== null && host === platform;
}

/** The tenant that owns the current request's host, or null on the platform host / unknown hosts. */
export const getRequestTenant = cache(async () => {
  const host = normalizeHost((await headers()).get("host"));
  if (!host || isPlatformHost(host)) return null;
  const domain = await db.tenantDomain.findUnique({ where: { host }, include: { tenant: true } });
  if (!domain || domain.tenant.status !== "ACTIVE") return null;
  return domain.tenant;
});
