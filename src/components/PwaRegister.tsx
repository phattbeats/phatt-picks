"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once, on the client, after load.
 * Mounted in the root layout so every route is PWA-installable (and so iOS
 * Web Push works once the user adds the app to their home screen).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Non-fatal: the app works fine without the SW; push/install just won't be available.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
