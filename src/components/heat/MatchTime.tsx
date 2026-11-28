"use client";

import { useEffect, useState } from "react";
import { localDayKey, relativeDay, type RelativeDay } from "@/lib/match-schedule-core";

/**
 * Local-clock formatting for match times (PHA-5538). Everything here runs in
 * the viewer's browser so the day and hour are THEIR day and hour; the server
 * never formats a match time.
 */

/** null until mounted, then ticks once a minute so "live" / "today" roll over without a reload. */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const REL_LABEL: Record<Exclude<RelativeDay, null>, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
};

/** "Today" / "Tomorrow" / "Yesterday", else "Sat, Nov 29". */
export function dayLabel(ms: number, nowMs: number): string {
  const rel = relativeDay(localDayKey(ms), localDayKey(nowMs));
  return rel ? REL_LABEL[rel] : formatDate(ms);
}

/**
 * One match's start: "17:00" today, "Tomorrow · 17:00", "Wed, Dec 10 · 17:00",
 * or "Time TBA" when the source has no time. Blank until mounted (server and
 * browser zones differ).
 */
export function MatchTime({ iso, ms, className }: { iso?: string | null; ms?: number | null; className?: string }) {
  const now = useNow();
  const t = ms ?? (iso ? Date.parse(iso) : NaN);
  const cls = className ? `mt-time ${className}` : "mt-time";
  if (t == null || !Number.isFinite(t)) return <span className={`${cls} tba`}>Time TBA</span>;
  if (now == null) return <span className={cls} aria-hidden="true" />;
  return (
    <span className={cls}>
      {dayLabel(t, now)} · {formatClock(t)}
    </span>
  );
}

/**
 * A Swiss bracket slot's start (PHA-5538): two short lines that fit between
 * the slot's logos at phone width, "TODAY" / "SUN" over the clock, with the
 * full date in the tooltip. "Live" once a paired match has started (until the
 * hourly crawl brings its score). Renders "VS" until mounted, since the server
 * doesn't know the viewer's zone.
 */
export function SlotTime({ ms, paired }: { ms: number; paired: boolean }) {
  const now = useNow();
  if (now == null) return <span className="vs">VS</span>;
  if (paired && now >= ms) return <span className="brkt-when live">Live</span>;
  const rel = relativeDay(localDayKey(ms), localDayKey(now));
  const day =
    rel === "today" ? "Today" : rel === "tomorrow" ? "Tmrw" : new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
  return (
    <span className="brkt-when" title={`${formatDate(ms)} · ${formatClock(ms)}`}>
      <span className="d">{day}</span>
      <span className="t">{formatClock(ms)}</span>
    </span>
  );
}
