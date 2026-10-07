import type { EtlContext } from "../context";
import { buildLegacyRedirects } from "../transforms/urls";
import { loadUrlMaps } from "./urlmaps";

/**
 * LEGACY redirect rows (old Concept500 URL → new URL) for paths the redirect runtime does not resolve
 * by itself. Upsert on (tenantId, fromPath); MANUAL rows of the owner are never touched; LEGACY rows
 * that are no longer generated are removed (so re-runs converge).
 */
export async function redirectsStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const maps = await loadUrlMaps(ctx);
  const { rows, rejected, handledByRuntime } = buildLegacyRedirects(maps);
  report.legacy("redirects", rows.length + rejected.length);
  for (const r of rejected) {
    report.skip("redirects", "onbruikbaar pad (normalisatie)");
    report.note("Redirects: overgeslagen", r);
  }
  report.note("Redirects", `${handledByRuntime} oude product-/tag-URL's worden door de redirect-runtime zelf afgehandeld (geen rij nodig)`);

  const existing = new Map((await tx.redirect.findMany({ where: { tenantId } })).map((r) => [r.fromPath, r]));
  const wanted = new Set(rows.map((r) => r.fromPath));
  for (const row of rows) {
    const cur = existing.get(row.fromPath);
    if (cur && cur.source === "MANUAL") {
      report.skip("redirects", "handmatige redirect bestaat al");
      continue;
    }
    if (cur) {
      if (cur.toPath === row.toPath && cur.statusCode === 301) report.unchanged("redirects");
      else {
        await tx.redirect.update({ where: { id: cur.id }, data: { toPath: row.toPath, statusCode: 301 } });
        report.updated("redirects");
      }
    } else {
      await tx.redirect.create({ data: { tenantId, fromPath: row.fromPath, toPath: row.toPath, statusCode: 301, source: "LEGACY" } });
      report.created("redirects");
    }
    report.note("Redirects (gegenereerd)", `[${row.kind}] ${row.fromPath} → ${row.toPath}`);
  }
  const stale = [...existing.values()].filter((r) => r.source === "LEGACY" && !wanted.has(r.fromPath));
  if (stale.length) {
    await tx.redirect.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    report.note("Redirects", `${stale.length} verouderde LEGACY-redirect(s) verwijderd`);
  }
}

/** Advance TenantSequence past the highest imported StockCode / order number (never backwards). */
export async function sequencesStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const maxCode = (await tx.product.aggregate({ where: { tenantId }, _max: { stockCode: true } }))._max.stockCode;
  const maxOrder = (await tx.order.aggregate({ where: { tenantId }, _max: { number: true } }))._max.number;
  for (const [name, value] of [
    ["product.stockCode", maxCode],
    ["order.number", maxOrder],
  ] as const) {
    if (!value) continue;
    await tx.$executeRaw`
      INSERT INTO tenant_sequences ("tenantId", name, value, "updatedAt") VALUES (${tenantId}, ${name}, ${value}, now())
      ON CONFLICT ("tenantId", name) DO UPDATE SET value = GREATEST(tenant_sequences.value, EXCLUDED.value), "updatedAt" = now()`;
    const row = await tx.tenantSequence.findUniqueOrThrow({ where: { tenantId_name: { tenantId, name } } });
    report.note("Sequences", `${name} = ${row.value} (volgende: ${row.value + 1})`);
  }
}
