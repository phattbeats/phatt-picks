"use client";

import { useEffect, useState } from "react";

/**
 * A single game's scheduled date + time chip (PHA-1007).
 *
 * Brandon: "stages ship with each game having its date and time attached." This
 * renders the committed start instant for one playoff game — e.g. "Jun 18 · 13:30"
 * — in the VIEWER's local timezone, so a fan reads the slot in their own clock.
 *
 * Renders NOTHING when:
 *   - `iso` is null/invalid (no authoritative time published — see
 *     lock-schedule-core's COLOGNE_PLAYOFF_SCHEDULE; truthful by construction)
 *   - it hasn't mounted yet (the locale/zone format differs server↔client, so we
 *     gate on mount the same way <LockCountdown> does to dodge a hydration
 *     mismatch).
 */
export function GameTime({
  iso,
  align = "center",
}: {
  iso: string | null;
  align?: "left" | "center";
}) {
  const ms = iso ? Date.parse(iso) : NaN;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!Number.isFinite(ms)) return null; // no committed time
  if (!mounted) return null; // pre-hydration — server and client formats can differ

  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="game-time"
      style={{
        display: "flex",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--ink-low)",
      }}
    >
      <span>{day}</span>
      <span style={{ color: "var(--hair-3)" }}>&middot;</span>
      <span>{time}</span>
    </div>
  );
}
