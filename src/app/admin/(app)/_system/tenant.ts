import "server-only";

/* Helpers for the system screens. Tenant basics come from getTenantDisplay() in @/server/tenant-display. */

/**
 * Link an invited owner opens to choose a password. The token is redeemed with auth `resetPassword()`.
 * The page is `/admin/reset-password` (auth screens), served on the tenant's primary host.
 */
export function inviteLink(host: string | null, token: string): string {
  const path = `/admin/reset-password?token=${encodeURIComponent(token)}`;
  if (!host) return path;
  const scheme = host.startsWith("localhost") || host.endsWith(".localhost") || host.endsWith(".test") ? "http" : "https";
  return `${scheme}://${host}${path}`;
}
