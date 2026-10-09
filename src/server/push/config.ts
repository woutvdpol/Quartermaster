/*
 * VAPID configuration (docs/push.md). One key pair for the whole platform: a subscription belongs to
 * the origin (shop domain) it was made on, but every shop signs with the same application server key.
 * Without the three env vars push is OFF: the shop hides every push option and alerts stay e-mail only.
 * Pure module (reads env per call so tests can toggle it).
 */

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return vapidConfig() !== null;
}

/** The public key for `pushManager.subscribe({ applicationServerKey })`; null when push is off. */
export function vapidPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}
