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

export type RequestScope =
  | { kind: "platform" }
  | { kind: "tenant"; tenant: NonNullable<Awaited<ReturnType<typeof findTenantByHost>>> }
  | { kind: "unknown" };

async function findTenantByHost(host: string) {
  const domain = await db.tenantDomain.findUnique({ where: { host }, include: { tenant: true } });
  return domain && domain.tenant.status === "ACTIVE" ? domain.tenant : null;
}

/**
 * Who serves this request: the platform host (SUPERADMIN), a shop's own domain, or an unknown host.
 * Unknown hosts must never fall back to the platform — that would expose the superadmin login anywhere.
 */
export const getRequestScope = cache(async (): Promise<RequestScope> => {
  const host = normalizeHost((await headers()).get("host"));
  if (!host) return { kind: "unknown" };
  if (isPlatformHost(host)) return { kind: "platform" };
  const tenant = await findTenantByHost(host);
  return tenant ? { kind: "tenant", tenant } : { kind: "unknown" };
});

/** The tenant that owns the current request's host, or null on the platform host / unknown hosts. */
export const getRequestTenant = cache(async () => {
  const scope = await getRequestScope();
  return scope.kind === "tenant" ? scope.tenant : null;
});
