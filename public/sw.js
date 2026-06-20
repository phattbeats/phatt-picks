/*
 * HOTLINE — service worker.
 * Two jobs: (1) satisfy PWA installability (manifest + SW with a fetch handler),
 * required for iOS Web Push; (2) receive push events and show pre-lock reminders.
 * Deliberately cache-light: this is a live, server-rendered app, so we never want
 * to serve stale picks/scores. We cache nothing.
 *
 * BYPASS DYNAMIC REQUESTS (PHA-1269). Earlier this handler called
 * `respondWith(fetch(req))` for EVERY GET. That is strictly worse than not
 * interposing: it does no caching, yet routes all traffic through the SW thread,
 * and — critically — it piped the long-lived notifications SSE stream
 * (`/api/notifications/stream`, an EventSource the header bell holds open) through
 * the worker. A streaming `respondWith` keeps the service worker alive holding the
 * response's buffers in the SW's OWN heap, which the page-level heap reclaim
 * (AutoRefresh, PHA-1268) can never reach — so over a multi-hour live session,
 * across the server's periodic stream recycles, that memory accrues unbounded and
 * starves low-RAM machines (Emily: "freezes the whole browser"). The fix: do NOT
 * call respondWith for streams / API / RSC / static — let the browser fetch them
 * natively with zero SW interposition. We keep a respondWith only for top-level
 * navigations (a single request per full page load) so Chrome still sees a
 * fetch-handling SW and the app stays installable.
 */

self.addEventListener("install", () => {
  // Activate this SW immediately on first install / update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Purge ALL Cache Storage on every activation. This app is deliberately
  // cache-light and stores nothing, but a prior SW iteration (or any future
  // regression) that did cache would otherwise leave stale entries that survive
  // reloads and deploys — the "saved cached version" Brandon flagged (PHA-1269).
  // Deleting unconditionally guarantees no stale build can ever be served.
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// The app caches nothing and serves everything live, so the worker intercepts
// NOTHING — it exists only to satisfy PWA installability and to receive push.
// An empty fetch listener still counts as a fetch handler for installability,
// while letting the browser do all networking natively.
//
// WHITE-SCREEN FIX (PHA-1269): the previous version intercepted document
// navigations and, on any fetch hiccup, returned `Response.error()`. In an
// installed PWA (standalone, no address bar) or on a flaky mobile connection,
// that turns a single transient navigation failure into a hard blank page with
// no way to retry — exactly the "white screen when logging in on Android" report.
// Not interposing means a failed navigation falls back to the browser's own
// retry/error handling instead of a dead white screen.
self.addEventListener("fetch", () => {});

// Web Push — all notification kinds share this handler. Payload shape: PreLockPayload
// from notify-core (title, body, url, tag, actions?).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "HOTLINE";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "phatt-picks",
    renotify: Boolean(data.tag),
    data: { url: data.url || "/picks" },
    requireInteraction: false,
    actions: Array.isArray(data.actions) ? data.actions : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Navigate to the notification's target URL — whether the user tapped the body
// or one of the action buttons (all actions deep-link to the same url).
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
