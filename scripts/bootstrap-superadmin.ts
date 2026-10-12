// Create the first platform superadmin on a fresh installation — no demo tenants, no other data.
// Production counterpart of the superadmin part of `prisma db seed` (docs/deploy.md §6).
//
//   SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… npm run db:bootstrap-superadmin
//   Kubernetes: deploy/k8s/jobs/bootstrap-superadmin.job.example.yaml (migrate image)
//
// Env:
//   DATABASE_URL           required
//   SUPERADMIN_EMAIL       required
//   SUPERADMIN_PASSWORD    required, ≥ MIN_PASSWORD_LENGTH characters. Change it after the first
//                          login and enable 2FA; this value is only used to create the account.
//   SUPERADMIN_NAME        optional, default "Platform Admin"
//
// Rules:
//  - Idempotent: when a SUPERADMIN with this email exists, nothing is changed (the password is NOT
//    reset, so re-running the Job never undoes a password change made in the admin).
//  - Refuses when another SUPERADMIN already exists: further admins are invited from the admin.
//  - Never prints the password.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/server/auth/password";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const email = requireEnv("SUPERADMIN_EMAIL").toLowerCase();
  const password = requireEnv("SUPERADMIN_PASSWORD");
  const name = process.env.SUPERADMIN_NAME?.trim() || "Platform Admin";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("SUPERADMIN_EMAIL is not a valid email address");
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`SUPERADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`);
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv("DATABASE_URL") }) });
  try {
    const superadmins = await db.user.findMany({
      where: { role: "SUPERADMIN", tenantId: null },
      select: { email: true },
    });
    if (superadmins.some((u) => u.email === email)) {
      console.log(`Superadmin ${email} already exists; nothing changed.`);
      return;
    }
    if (superadmins.length > 0) {
      throw new Error(
        `A superadmin already exists (${superadmins.map((u) => u.email).join(", ")}); invite further admins from the admin.`,
      );
    }
    // SUPERADMIN uniqueness on (tenantId NULL, email) is a partial index; a platform user with this
    // email and another role would collide with it, so refuse instead of silently promoting it.
    const other = await db.user.findFirst({ where: { tenantId: null, email }, select: { role: true } });
    if (other) throw new Error(`A platform user ${email} with role ${other.role} already exists`);

    await db.user.create({
      data: {
        role: "SUPERADMIN",
        tenantId: null,
        email,
        name,
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Created superadmin ${email}. Log in, change the password and enable 2FA.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
