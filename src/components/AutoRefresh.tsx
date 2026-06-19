"use client";

import { useEffect, useRef } from "react";
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
 *
 * BOUNDED HEAP (PHA-1268): repeated `router.refresh()` in the Next App Router is
 * a known client-memory-growth pattern — each refresh hands the client router a
 * fresh RSC payload, and the accumulated router cache / detached React trees
 * climb monotonically over a long foreground session (e.g. camping `/picks` for
 * a multi-hour live playoff day). On a RESULTS-ONLY view — a locked stage or a
 * sealed playoff bracket where no picks are being edited — we cap that growth by
 * periodically doing a hard `location.reload()` instead of another in-place
 * refresh: a full reload reclaims the entire heap and resets the sawtooth, and
 * on a passive lineup it's visually indistinguishable from a refresh (it re-runs
 * the same RSC and lands on the same scroll-top view). `reclaimSafe` is OFF by
 * default and only set where a reload can't discard unsaved local picks, so an
 * editable picker keeps the gentle in-place refresh.
 */
export function AutoRefresh({
  intervalMs = 60_000,
  reclaimSafe = false,
  reclaimAfter = 20,
}: {
  intervalMs?: number;
  /** Results-only view (no picks being edited) — allow the periodic hard reload. */
  reclaimSafe?: boolean;
  /** Refreshes between hard reloads on a reclaim-safe view (≈ minutes at 60s). */
  reclaimAfter?: number;
}) {
  const router = useRouter();
  // Count of refreshes since the last (re)mount. A hard reload remounts the
  // component, so this naturally resets to zero each reclaim cycle.
  const refreshes = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshes.current += 1;
      if (reclaimSafe && reclaimAfter > 0 && refreshes.current >= reclaimAfter) {
        // Reclaim the heap wholesale rather than accruing another RSC payload.
        window.location.reload();
        return;
      }
      router.refresh();
    };
    const start = () => {
      stop();
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
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
  }, [router, intervalMs, reclaimSafe, reclaimAfter]);
  return null;
}
