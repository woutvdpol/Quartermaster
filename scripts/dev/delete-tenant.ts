// DEV ONLY: hard-delete a test tenant and everything that belongs to it.
//
//   npm run tenant:delete -- <slug> --confirm <slug> [--dry-run] [--keep-uploads] [--allow-demo] [--force-remote]
//
// Flags:
//   --confirm <slug>  required; must repeat the slug exactly.
//   --dry-run         runs every DELETE inside the transaction, prints the counts, then ROLLS BACK
//                     (uploads are left alone too).
//   --keep-uploads    don't remove <UPLOADS_DIR>/<tenantId>/.
//   --allow-demo      allow deleting the seeded demo tenants concept-militaria / veldpost-antiek.
//   --force-remote    allow a DATABASE_URL whose host isn't localhost/127.0.0.1/::1. Think twice:
//                     this deletes orders, invoices and payments, which the app itself never does.
// NODE_ENV=production always refuses; there is no override.
//
// What it does, in ONE transaction (FK order; many tenant relations are onDelete: Restrict and
// orders/invoices/payments are normally immutable — test tenants are the explicit exception):
// search/embeddings, alerts, carts/reservations, coupons, orders (+ payments, invoices, lines, events,
// addresses), catalog (products + children, categories, tags, facets, suppliers, purchases), customers,
// content, shipping, newsletter, leads, analytics, redirects, settings, sequences, import jobs, audit
// logs, the tenant users' sessions/auth tokens/recovery codes, the users, the linked dealer
// application, domains, pg-boss jobs whose data mentions the tenant id, and finally the tenant row.
// Before committing it checks that no table with a "tenantId" column still references the tenant
// (also catches tables added later that this script doesn't know about yet). After commit it removes
// the tenant's upload directory.
import "dotenv/config";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { checkDeleteTenantGuards, parseDeleteTenantArgs } from "./delete-tenant-guard";

const USERS = `(SELECT id FROM users WHERE "tenantId" = $1)`;
const byTenant = (table: string) => ({ table, sql: `DELETE FROM ${table} WHERE "tenantId" = $1` });

/** Ordered: children before parents. Each statement takes the tenant id as $1. */
const STEPS: { table: string; sql: string }[] = [
  // Search
  byTenant("product_embeddings"),
  byTenant("search_index_runs"),
  byTenant("product_facet_values"),
  // Alerts / saved searches / wishlists
  byTenant("alert_deliveries"),
  byTenant("saved_searches"),
  byTenant("wishlist_items"),
  // Carts & stock
  byTenant("cart_items"),
  byTenant("stock_movements"),
  byTenant("reservations"),
  byTenant("carts"),
  // Coupons
  byTenant("coupon_redemptions"),
  byTenant("coupons"),
  // Orders (payments/invoices are Restrict on orders)
  byTenant("payments"),
  byTenant("invoices"),
  byTenant("order_events"),
  byTenant("order_lines"),
  byTenant("order_addresses"),
  byTenant("orders"),
  // Catalog (offers/certificates are Restrict on products)
  byTenant("offers"),
  byTenant("certificates"),
  byTenant("product_documents"),
  byTenant("product_relations"),
  byTenant("product_tags"),
  byTenant("product_images"),
  byTenant("products"),
  byTenant("purchase_records"),
  byTenant("suppliers"),
  byTenant("compliance_rules"),
  byTenant("categories"),
  byTenant("tags"),
  byTenant("facet_values"),
  byTenant("facets"),
  // Customers
  byTenant("addresses"),
  byTenant("newsletter_subscribers"),
  byTenant("customers"),
  // Content & shipping & marketing
  byTenant("content_blocks"),
  byTenant("menu_items"),
  byTenant("content_pages"),
  byTenant("shipping_rates"),
  byTenant("shipping_zones"),
  byTenant("newsletter_campaigns"),
  byTenant("leads"),
  byTenant("page_views"),
  byTenant("redirects"),
  // Tenant plumbing
  byTenant("settings"),
  byTenant("tenant_sequences"),
  byTenant("import_jobs"),
  byTenant("audit_logs"),
  // Users of the tenant (never the superadmin: its tenantId is NULL)
  { table: "sessions", sql: `DELETE FROM sessions WHERE "userId" IN ${USERS}` },
  { table: "auth_tokens", sql: `DELETE FROM auth_tokens WHERE "userId" IN ${USERS}` },
  { table: "recovery_codes", sql: `DELETE FROM recovery_codes WHERE "userId" IN ${USERS}` },
  byTenant("users"),
  byTenant("dealer_applications"),
  byTenant("tenant_domains"),
];

function uploadsRoot() {
  return process.env.UPLOADS_DIR || process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
}

async function main() {
  const args = parseDeleteTenantArgs(process.argv.slice(2));
  const guard = checkDeleteTenantGuards({ nodeEnv: process.env.NODE_ENV, databaseUrl: process.env.DATABASE_URL, args });
  if (!guard.ok) {
    console.error(`✖ ${guard.reason}`);
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let tenantId: string;
  try {
    const t = await client.query<{ id: string; name: string }>(`SELECT id, name FROM tenants WHERE slug = $1`, [guard.slug]);
    if (!t.rowCount) throw new Error(`Tenant "${guard.slug}" not found.`);
    tenantId = t.rows[0].id;
    console.log(`${args.dryRun ? "[DRY RUN] " : ""}Deleting tenant "${guard.slug}" (${t.rows[0].name}, id ${tenantId})`);

    // Every table with a "tenantId" column must be covered by STEPS (guards against new tables).
    const cols = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenantId'`,
    );
    const known = new Set([...STEPS.map((s) => s.table), "tenants"]);
    const unknown = cols.rows.map((r) => r.table_name).filter((n) => !known.has(n));
    if (unknown.length) throw new Error(`Tables with a tenantId column not handled by this script: ${unknown.join(", ")}. Update STEPS.`);

    await client.query("BEGIN");
    const counts: [string, number][] = [];
    for (const step of STEPS) {
      const res = await client.query(step.sql, [tenantId]);
      counts.push([step.table, res.rowCount ?? 0]);
    }
    const hasBoss = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job'`);
    if (hasBoss.rowCount) {
      const res = await client.query(`DELETE FROM pgboss.job WHERE data::text LIKE '%' || $1 || '%'`, [tenantId]);
      counts.push(["pgboss.job", res.rowCount ?? 0]);
    }
    const tenantRes = await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    counts.push(["tenants", tenantRes.rowCount ?? 0]);

    // Verify nothing still points at the tenant before committing.
    const leftovers: string[] = [];
    for (const { table_name } of cols.rows) {
      const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table_name}" WHERE "tenantId" = $1`, [tenantId]);
      if (r.rows[0].n !== "0") leftovers.push(`${table_name}=${r.rows[0].n}`);
    }
    if (leftovers.length) throw new Error(`Rows still reference the tenant: ${leftovers.join(", ")}`);

    const width = Math.max(...counts.map(([n]) => n.length));
    for (const [table, n] of counts) if (n > 0) console.log(`  ${table.padEnd(width)}  ${n}`);
    const total = counts.reduce((s, [, n]) => s + n, 0);
    const untouched = counts.filter(([, n]) => n === 0).map(([n]) => n);
    console.log(`  ${"TOTAL".padEnd(width)}  ${total}`);
    if (untouched.length) console.log(`  (0 rows: ${untouched.join(", ")})`);

    if (args.dryRun) {
      await client.query("ROLLBACK");
      console.log("[DRY RUN] Rolled back — nothing was deleted.");
      return;
    }
    await client.query("COMMIT");
    console.log("Committed.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  if (args.keepUploads) return;
  const dir = path.join(uploadsRoot(), tenantId);
  const exists = await stat(dir).then((s) => s.isDirectory(), () => false);
  if (exists) {
    await rm(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}`);
  } else {
    console.log(`No upload directory at ${dir}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `✖ ${err.message}` : err);
  process.exitCode = 1;
});
