// Pure argument parsing + safety guards for scripts/dev/delete-tenant.ts (unit-tested in
// tests/dev/delete-tenant-guard.test.ts). No I/O here.

/** Demo tenants seeded by `npm run db:seed` / `db:seed:demo`: protected unless --allow-demo. */
export const PROTECTED_DEMO_SLUGS = ["concept-militaria", "veldpost-antiek"] as const;

/** Hosts considered "local" for DATABASE_URL. Anything else needs --force-remote. */
export const LOCAL_DB_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"] as const;

export type DeleteTenantArgs = {
  slug: string | null;
  confirm: string | null;
  dryRun: boolean;
  forceRemote: boolean;
  allowDemo: boolean;
  keepUploads: boolean;
};

export function parseDeleteTenantArgs(argv: readonly string[]): DeleteTenantArgs {
  const args: DeleteTenantArgs = { slug: null, confirm: null, dryRun: false, forceRemote: false, allowDemo: false, keepUploads: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force-remote") args.forceRemote = true;
    else if (a === "--allow-demo") args.allowDemo = true;
    else if (a === "--keep-uploads") args.keepUploads = true;
    else if (a === "--confirm") args.confirm = argv[++i] ?? "";
    else if (a.startsWith("--confirm=")) args.confirm = a.slice("--confirm=".length);
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else if (args.slug === null) args.slug = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return args;
}

/** Hostname of a postgres connection string, or null when it can't be parsed. */
export function databaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export type GuardInput = {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  args: DeleteTenantArgs;
};

export type GuardResult = { ok: true; slug: string } | { ok: false; reason: string };

/**
 * Decides whether a tenant deletion may run. Rules:
 * - a slug is required and `--confirm <slug>` must repeat it exactly;
 * - NODE_ENV=production always refuses (no override);
 * - DATABASE_URL must point at localhost/127.0.0.1/::1, unless --force-remote;
 * - the seeded demo tenants (concept-militaria, veldpost-antiek) need --allow-demo.
 */
export function checkDeleteTenantGuards({ nodeEnv, databaseUrl, args }: GuardInput): GuardResult {
  const slug = args.slug?.trim();
  if (!slug) return { ok: false, reason: "Missing tenant slug. Usage: npm run tenant:delete -- <slug> --confirm <slug> [--dry-run]" };
  if (args.confirm !== slug) return { ok: false, reason: `Confirmation mismatch: pass --confirm ${slug} to delete tenant "${slug}".` };
  if (nodeEnv === "production") return { ok: false, reason: "Refusing to run with NODE_ENV=production." };
  const host = databaseHost(databaseUrl);
  if (!host) return { ok: false, reason: "DATABASE_URL is missing or unparseable." };
  if (!(LOCAL_DB_HOSTS as readonly string[]).includes(host) && !args.forceRemote) {
    return { ok: false, reason: `DATABASE_URL host "${host}" is not local; pass --force-remote if you really mean it.` };
  }
  if ((PROTECTED_DEMO_SLUGS as readonly string[]).includes(slug) && !args.allowDemo) {
    return { ok: false, reason: `"${slug}" is a seeded demo tenant; pass --allow-demo to delete it anyway.` };
  }
  return { ok: true, slug };
}
