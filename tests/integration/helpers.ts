import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import type { Role } from "@/generated/prisma/enums";

/** Empties every application table (keeps migrations). Call in beforeEach. */
export async function resetDb() {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;

/** Creates a tenant plus an OWNER and returns a ServiceContext acting as that owner. */
export async function createTenantContext(opts: { slug?: string; role?: Extract<Role, "OWNER" | "SUPERADMIN"> } = {}): Promise<ServiceContext> {
  counter += 1;
  const slug = opts.slug ?? `shop-${counter}`;
  const tenant = await db.tenant.create({ data: { slug, name: `Shop ${counter}` } });
  const role = opts.role ?? "OWNER";
  const user = await db.user.create({
    data: { role, tenantId: role === "SUPERADMIN" ? null : tenant.id, email: `${role.toLowerCase()}-${counter}@test.local` },
  });
  return { tenantId: tenant.id, actor: { id: user.id, role: user.role, tenantId: user.tenantId, email: user.email } };
}
