import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaClass?: typeof PrismaClient };

/**
 * Max connections in this process's pool (env DATABASE_POOL_MAX, docs/deploy.md). Unset/invalid →
 * node-postgres' default (10). Size it so replicas × max (+ worker, migrations) stays below the
 * server's max_connections.
 */
export function poolMaxFromEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    console.warn(`[db] ignoring invalid DATABASE_POOL_MAX=${JSON.stringify(value)} (expected an integer 1–500)`);
    return undefined;
  }
  return n;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const max = poolMaxFromEnv(process.env.DATABASE_POOL_MAX);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, ...(max ? { max } : {}) }) });
}

// Reuse one client across hot reloads in development — unless `prisma generate` produced a new client
// class (new models), then the stale client is replaced instead of lacking the new delegates.
const cached = globalForPrisma.prismaClass === PrismaClient ? globalForPrisma.prisma : undefined;
if (!cached && globalForPrisma.prisma) void globalForPrisma.prisma.$disconnect().catch(() => {});
export const db = cached ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaClass = PrismaClient;
}
