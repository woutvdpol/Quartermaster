import { normalizeDomainHost } from "../../../src/server/platform/hosts";
import { SETTINGS_GROUPS, defaultSettings } from "../../../src/server/settings/schema";
import { ETL_MARK, json, type EtlOptions, type Tx } from "../context";
import type { EtlReport } from "../report";

export class EtlAbort extends Error {}

/**
 * Finds or creates the target tenant (+ primary domain + default settings rows, like
 * platform/tenants.createTenant but without the owner invite: owners come from legacy users).
 * Guard: a tenant that already holds catalog data NOT created by this ETL (e.g. the demo tenants) is
 * refused unless --force.
 */
export async function ensureTenant(
  tx: Tx,
  options: EtlOptions,
  report: EtlReport,
  legacyShopName: string | null,
): Promise<{ tenantId: string; currency: string; created: boolean }> {
  const slug = options.tenantSlug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new EtlAbort(`Invalid tenant slug "${options.tenantSlug}"`);
  const host = options.domain ? normalizeDomainHost(options.domain) : null;
  if (options.domain && !host) throw new EtlAbort(`Invalid domain "${options.domain}"`);

  let tenant = await tx.tenant.findUnique({ where: { slug } });
  let created = false;
  if (!tenant) {
    if (!host) throw new EtlAbort(`Tenant "${slug}" does not exist: pass --domain <host> to create it`);
    const name = (options.tenantName ?? legacyShopName ?? slug).trim().slice(0, 120) || slug;
    tenant = await tx.tenant.create({ data: { slug, name, currency: "EUR", timezone: "Europe/Amsterdam" } });
    await tx.setting.createMany({
      data: SETTINGS_GROUPS.map((group) => {
        const data = defaultSettings(group) as Record<string, unknown>;
        if (group === "general") data.shopName = name;
        return { tenantId: tenant!.id, group, data: json(data) };
      }),
    });
    created = true;
    report.note("Tenant", `Tenant aangemaakt: ${slug}`);
  } else {
    // Raw SQL: a Prisma JSON-path NOT filter skips rows where the path is missing (NULL semantics).
    const [{ n: foreign }] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM products
      WHERE "tenantId" = ${tenant.id} AND ("legacyData"->>'etl') IS DISTINCT FROM ${ETL_MARK}`;
    if (foreign > 0 && !options.force) {
      throw new EtlAbort(
        `Tenant "${slug}" already has ${foreign} products that were not imported by this ETL (demo/live data?). ` +
          "Refusing to import into it; use a new tenant or pass --force.",
      );
    }
    report.note("Tenant", `Bestaande tenant gebruikt: ${slug}`);
  }

  if (host) {
    const domain = await tx.tenantDomain.findUnique({ where: { host } });
    if (domain && domain.tenantId !== tenant.id) throw new EtlAbort(`Domain ${host} belongs to another tenant`);
    if (!domain) {
      const hasPrimary = (await tx.tenantDomain.count({ where: { tenantId: tenant.id, isPrimary: true } })) > 0;
      await tx.tenantDomain.create({ data: { tenantId: tenant.id, host, isPrimary: !hasPrimary } });
      report.note("Tenant", `Domein toegevoegd: ${host}${hasPrimary ? "" : " (primair)"}`);
    }
  }
  return { tenantId: tenant.id, currency: tenant.currency, created };
}
