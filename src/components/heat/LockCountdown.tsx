"use client";

import { useEffect, useState } from "react";

/**
 * Live "until picks lock" countdown (PHA-856, mockup-02).
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

export function LockCountdown({
  lockAt,
  caption = "until picks lock",
  align = "left",
}: {
  lockAt: string | null;
  caption?: string;
  align?: "left" | "center";
}) {
  const target = lockAt ? Date.parse(lockAt) : NaN;
  // null until mounted so server and first client render agree (both null).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!Number.isFinite(target)) return null; // no committed lock time
  if (now === null) return null; // pre-hydration
  const remaining = target - now;
  if (remaining <= 0) return null; // already locked — stage-gate owns that state

  const ember = remaining <= EMBER_MS;

  return (
    <div
      className="lock-cd"
      role="timer"
      aria-label={`${caption}: ${format(remaining)}`}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 8,
        justifyContent: align === "center" ? "center" : "flex-start",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          fontSize: "clamp(20px, 4.5vw, 26px)",
          letterSpacing: "0.04em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: ember ? "var(--heat)" : "var(--ink-hi)",
          textShadow: ember ? "0 0 14px rgba(240,163,0,0.45)" : "none",
          transition: "color 300ms var(--ease, ease)",
        }}
      >
        {format(remaining)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: ember ? "var(--heat)" : "var(--ink-low)",
        }}
      >
        {caption}
      </span>
    </div>
  );
}
