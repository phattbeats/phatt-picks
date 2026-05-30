/*
 * phaTT Picks — service worker.
 * Two jobs: (1) satisfy PWA installability (manifest + SW with a fetch handler),
 * required for iOS Web Push; (2) receive push events and show pre-lock reminders.
 * Deliberately cache-light: this is a live, server-rendered app, so we never want
 * to serve stale picks/scores. The fetch handler is a network passthrough.
 */

self.addEventListener("install", () => {
  // Activate this SW immediately on first install / update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Network passthrough — present so the app meets installability criteria,
// but intentionally does no caching of dynamic app data.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});

// Web Push — render a pre-lock reminder. Payload shape comes from notify-core.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "phaTT Picks";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "phatt-picks",
    renotify: Boolean(data.tag),
    data: { url: data.url || "/picks" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab on the target URL, or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      })
  );
});
