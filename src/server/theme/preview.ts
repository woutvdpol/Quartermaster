import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import { canAccessTenant, currentUser } from "@/server/auth/guards";
import { normalizeHost } from "@/server/tenant";
import { THEME_PREVIEW_COOKIE, THEME_PREVIEW_HEADER } from "@/lib/theme-preview";
import { getThemeDraft } from "./index";
import type { Theme } from "./presets";

/**
 * Theme preview for the current shop request (see src/lib/theme-preview.ts).
 * Returns null unless preview was requested AND the visitor is signed-in staff of this tenant;
 * otherwise `{ draft }` (null draft = nothing unpublished, the shop shows the live theme + ribbon).
 * Costs nothing for normal visitors: without the cookie/header there is no DB access.
 */
export const getThemePreview = cache(async (tenantId: string): Promise<{ draft: Theme | null } | null> => {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const flag = h.get(THEME_PREVIEW_HEADER);
  if (flag === "0") return null;
  if (flag !== "1" && c.get(THEME_PREVIEW_COOKIE)?.value !== "1") return null;
  const user = await currentUser();
  if (!user || user.role === "CUSTOMER" || !canAccessTenant(user, tenantId)) return null;
  return { draft: await getThemeDraft(tenantId) };
});

const withoutPort = (h: string) => h.replace(/:\d+$/, "");

/**
 * Is `host` one of the tenant's domains? Compared case-insensitively, and also without the port
 * (a local domain stored as "shop.localhost" serves "shop.localhost:3000"). Pure, for tests.
 */
export function hostBelongsToTenant(host: string | null | undefined, domains: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return domains.some((d) => {
    const n = normalizeHost(d);
    return !!n && (n === h || withoutPort(n) === withoutPort(h));
  });
}

/**
 * Can the theme builder preview this tenant's shop in a same-origin iframe from the admin at
 * `host`? True on any of the tenant's own domains (primary or not). Otherwise returns the
 * tenant's primary domain so the builder can link to the admin there.
 */
export async function themePreviewHostInfo(tenantId: string, host: string | null | undefined): Promise<{ available: boolean; primaryHost: string | null }> {
  const domains = await db.tenantDomain.findMany({
    where: { tenantId },
    select: { host: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return {
    available: hostBelongsToTenant(host, domains.map((d) => d.host)),
    primaryHost: domains[0]?.host ?? null,
  };
}
