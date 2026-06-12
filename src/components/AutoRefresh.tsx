"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-renders the current route's server components so a live view
 * (e.g. the Swiss lineup, PHA-898) tracks fresh results without a manual reload.
 * `router.refresh()` re-runs the RSC on the server — which re-triggers the
 * on-read outcomes driver (refreshOutcomesOnRead) — and reconciles the tree in
 * place, so it doesn't lose scroll position or client state.
 *
 * Pauses while the tab is hidden so a backgrounded PWA isn't polling all day,
 * and refreshes once immediately on becoming visible again.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
