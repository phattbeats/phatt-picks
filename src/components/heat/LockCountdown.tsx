"use client";

import { useEffect, useState } from "react";

/**
 * Live "until picks lock" countdown (#856, mockup-02).
 *
 * Renders a mono HH:MM:SS clock + caption that ticks every second and turns
 * ember in the final 15 minutes. Renders NOTHING when:
 *   - `lockAt` is null/invalid (no committed lock time — see lock-schedule-core)
 *   - the lock instant has already passed (the stage-gate shows the locked
 *     state from there; a 00:00:00 clock would be noise)
 *   - it hasn't mounted yet (avoids an SSR/CSR hydration mismatch on the clock)
 *
 * This keeps the clock truthful: it only ever appears when there is a real,
 * future, published lock time to count toward.
 */

const EMBER_MS = 15 * 60 * 1000; // turn ember under 15 min, per mockup

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Lockbox clock: "1d 04:12:33" (days only when ≥ 24h remain). */
function DayClock({ ms }: { ms: number }) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const rest = format((total % 86400) * 1000);
  return d > 0 ? (
    <>
      {d}
      <small>d</small> {rest}
    </>
  ) : (
    <>{rest}</>
  );
}

/** Lock instant in the viewer's own timezone, e.g. "Sun 29 Nov · 18:30". */
function localLockLabel(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

export function LockCountdown({
  lockAt,
  caption = "until picks lock",
  align = "left",
  variant = "inline",
  boxLabel = "Locks in",
}: {
  lockAt: string | null;
  caption?: string;
  align?: "left" | "center";
  /**
   * "inline" (default): clock + caption on one line.
   * "box": the Pick'Em stage-header lockbox — "Locks in" / clock / local lock
   * time, as three stacked spans for a `.sgp-lockbox` parent.
   */
  variant?: "inline" | "box";
  /** First lockbox line for the "box" variant. */
  boxLabel?: string;
}) {
  const target = lockAt ? Date.parse(lockAt) : NaN;
  // null until mounted so server and first client render agree (both null).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    // Sync to the wall clock immediately on mount so the clock appears at once
    // rather than after the first 1s tick; the null→now transition is exactly
    // the post-hydration sync this component is built around (see header note).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!Number.isFinite(target)) return null; // no committed lock time

  if (variant === "box") {
    // Pre-hydration: hold the lockbox's shape with a dash instead of collapsing.
    if (now === null) {
      return (
        <>
          <span className="k">{boxLabel}</span>
          <span className="v cd">—</span>
          <span className="k">&nbsp;</span>
        </>
      );
    }
    const remaining = target - now;
    if (remaining <= 0) {
      return (
        <>
          <span className="k">Status</span>
          <span className="v sm">Locked</span>
        </>
      );
    }
    return (
      <>
        <span className="k">{boxLabel}</span>
        <span className="v cd" role="timer" aria-label={`${caption}: ${format(remaining)}`}>
          <DayClock ms={remaining} />
        </span>
        <span className="k">{localLockLabel(target)}</span>
      </>
    );
  }

  if (now === null) return null; // pre-hydration
  const remaining = target - now;
  if (remaining <= 0) return null; // already locked — stage-gate owns that state

  const ember = remaining <= EMBER_MS;

  return (
    <div
      className={`lock-cd${align === "center" ? " center" : ""}${ember ? " ember" : ""}`}
      role="timer"
      aria-label={`${caption}: ${format(remaining)}`}
    >
      <span className="t">{format(remaining)}</span>
      <span className="c">{caption}</span>
    </div>
  );
}
