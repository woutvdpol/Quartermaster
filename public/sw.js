/*
 * Quartermaster shop service worker — web push only (docs/push.md). Deliberately tiny: no fetch
 * handler and no caching, so it never sits between the shop and the network.
 * Served from every shop domain at /sw.js (scope "/"); registered only when a logged-in customer turns
 * on push (src/components/shop/push/client.ts).
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "New alert", {
      body: data.body || "",
      icon: data.icon || undefined,
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: !!data.urgent,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
