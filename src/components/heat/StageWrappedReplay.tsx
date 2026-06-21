"use client";

import { type ReactNode, useEffect } from "react";
import { replayStageWrapped } from "./StageWrapped";

/**
 * Replay entry point for the Stage Wrapped deck (PHA-1054). The deck auto-opens
 * once per stage (localStorage-gated in `StageWrappedAnnounce`); this button lets
 * a viewer re-open it any time via the replay bus. Tiny client island so the
 * reveal page (and the home send-off) can stay server components. No-ops
 * harmlessly if the matching launcher isn't mounted (e.g. an unauthored stage
 * with an empty deck). `className`/`children` let it render as the primary heat
 * CTA with a chevron, not only the default ghost button.
 */
export function StageWrappedReplay({
  stageKey,
  label = "Replay the recap",
  className = "btn-ghost",
  children,
}: {
  stageKey: string;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button type="button" className={className} onClick={() => replayStageWrapped(stageKey)}>
      {label}
      {children}
    </button>
  );
}

/**
 * Fire a one-shot replay for `stageKey` on mount when `active` — the server-side
 * `?wrapped=1` deep link's client arm. Re-opens the recap even on a device that
 * already dismissed the once-per-viewer auto-popup, by poking the app-wide
 * launcher through the replay bus rather than mounting a second copy of the deck
 * (PHA-1274). Deferred (and fired twice) so the launcher's own replay listener
 * is attached first — effects run children-before-parents, and the launcher
 * lives in the layout above this page. Idempotent: opening an already-open deck
 * is a no-op.
 */
export function WrappedReplayOnLoad({ stageKey, active }: { stageKey: string; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const t1 = setTimeout(() => replayStageWrapped(stageKey), 300);
    const t2 = setTimeout(() => replayStageWrapped(stageKey), 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active, stageKey]);
  return null;
}
