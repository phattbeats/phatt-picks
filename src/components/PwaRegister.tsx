"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once, on the client, after load.
 * Mounted in the root layout so every route is PWA-installable (and so iOS
 * Web Push works once the user adds the app to their home screen).
 *
 * AUTO-UPDATE (PHA-1269): an installed PWA / open tab can keep running an old
 * build long after a deploy — exactly the "loads the cached version" report. So
 * we (1) ask the browser to check for a fresh `sw.js` on load, and (2) when a new
 * worker takes control (`controllerchange`, which fires after the new SW's
 * skipWaiting + clients.claim and its cache purge), reload the page ONCE to pull
 * the fresh HTML/CSS/JS. The guard avoids reloading on the very first
 * registration (no previous controller), so a brand-new visit doesn't bounce.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // Reload once when a NEW worker takes over (an update landed) — never on the
    // first-ever controller for this page.
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Proactively check for a newer worker on every load so a stale install
          // updates promptly instead of waiting for the browser's own interval.
          reg.update().catch(() => {});
        })
        .catch(() => {
          // Non-fatal: the app works fine without the SW; push/install just won't be available.
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
