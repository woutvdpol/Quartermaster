/*
 * Browser side of web push (docs/push.md). Only imported by client components. The service worker
 * (/sw.js) is registered on demand — when a customer turns push on — never on page load (perf).
 */

export type PushSupport =
  /** Service worker + Push API available. */
  | "supported"
  /** iPhone/iPad Safari outside the home-screen app: push only works after "Add to Home Screen". */
  | "ios-install"
  | "unsupported";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "ios-install";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported";
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/** The push subscription of this browser on this shop, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export class PushPermissionError extends Error {
  constructor(public readonly permission: NotificationPermission) {
    super(`Notification permission: ${permission}`);
  }
}

/**
 * Asks for permission (call straight from a click handler — browsers require a user gesture),
 * registers /sw.js and subscribes. Returns the subscription JSON for the server.
 */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionError(permission);
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const reg = await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // made with another VAPID key (key rotation)
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub.toJSON();
}

/** Unsubscribes this browser; returns its endpoint (so the server can delete the row). */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}
