// Local development seed. Run with `npx prisma db seed` (configured in prisma.config.ts).
// Idempotent: safe to run repeatedly; existing settings rows are never overwritten.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Role } from "../src/generated/prisma/enums";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "../src/server/auth/password";
import { SETTINGS_GROUPS, defaultSettings, type SettingsGroup } from "../src/server/settings/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type TenantSeed = {
  slug: string;
  name: string;
  domains: { host: string; isPrimary: boolean }[];
};

const TENANTS: TenantSeed[] = [
  {
    slug: "concept-militaria",
    name: "Concept Militaria",
    domains: [
      { host: "concept.localhost:3000", isPrimary: true },
      { host: "localhost:3001", isPrimary: false },
    ],
  },
  {
    slug: "veldpost-antiek",
    name: "Veldpost Antiek",
    domains: [{ host: "veldpost.localhost:3000", isPrimary: true }],
  },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

function credentials(prefix: "SEED_SUPERADMIN" | "SEED_OWNER") {
  const email = requireEnv(`${prefix}_EMAIL`).toLowerCase();
  const password = requireEnv(`${prefix}_PASSWORD`);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${prefix}_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return { email, password };
}

async function seedTenant(t: TenantSeed) {
  const tenant = await db.tenant.upsert({
    where: { slug: t.slug },
    create: { slug: t.slug, name: t.name },
    update: { name: t.name },
  });
  for (const d of t.domains) {
    await db.tenantDomain.upsert({
      where: { host: d.host },
      create: { tenantId: tenant.id, host: d.host, isPrimary: d.isPrimary },
      update: { tenantId: tenant.id, isPrimary: d.isPrimary },
    });
  }
  return tenant;
}

/**
 * Create or reconcile a user. The password is only re-hashed when the stored hash no longer
 * matches the .env password, so repeated runs don't churn.
 */
async function seedUser(opts: { role: Role; tenantId: string | null; email: string; password: string; name: string }) {
  // Prisma can't upsert on (tenantId, email) with a NULL tenantId; SUPERADMIN uniqueness is a partial index.
  const existing = await db.user.findFirst({ where: { tenantId: opts.tenantId, email: opts.email } });
  if (!existing) {
    return db.user.create({
      data: {
        role: opts.role,
        tenantId: opts.tenantId,
        email: opts.email,
        name: opts.name,
        passwordHash: await hashPassword(opts.password),
        emailVerifiedAt: new Date(),
      },
    });
  }
  const passwordOk = existing.passwordHash ? await verifyPassword(opts.password, existing.passwordHash) : false;
  return db.user.update({
    where: { id: existing.id },
    data: {
      role: opts.role,
      disabledAt: null,
      ...(passwordOk ? {} : { passwordHash: await hashPassword(opts.password) }),
    },
  });
}

async function seedSettings(tenantId: string, tenantName: string) {
  for (const group of SETTINGS_GROUPS) {
    const data = initialSettings(group, tenantName) as Prisma.InputJsonValue;
    await db.setting.upsert({
      where: { tenantId_group: { tenantId, group } },
      create: { tenantId, group, data },
      update: {}, // never overwrite settings changed in the admin
    });
  }
}

function initialSettings(group: SettingsGroup, tenantName: string) {
  const defaults = defaultSettings(group);
  if (group === "general") return { ...defaults, shopName: tenantName };
  return defaults;
}

// ─── Catalog / orders ───────────────────────────────────────────────────────
// TODO(phase 1): seed categories, products, customers and orders once the domain models exist
// in prisma/schema.prisma. Keep it idempotent (upsert on natural keys such as tenantId + stockCode).
async function seedCatalog(_tenants: { id: string; slug: string }[]) {
  // intentionally empty until domain models land
}

async function main() {
  const superadmin = credentials("SEED_SUPERADMIN");
  const owner = credentials("SEED_OWNER");

  const tenants = [];
  for (const t of TENANTS) {
    const tenant = await seedTenant(t);
    await seedSettings(tenant.id, tenant.name);
    tenants.push(tenant);
  }
  const concept = tenants.find((t) => t.slug === "concept-militaria")!;

  await seedUser({ role: "SUPERADMIN", tenantId: null, name: "Quartermaster Admin", ...superadmin });
  await seedUser({ role: "OWNER", tenantId: concept.id, name: "Concept Owner", ...owner });

  await seedCatalog(tenants);

  console.log(`Seeded ${tenants.length} tenants (${tenants.map((t) => t.slug).join(", ")}), superadmin and owner.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
