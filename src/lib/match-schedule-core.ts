/**
 * Local-day rules for match start times (PHA-5538): the day keys behind the
 * "Today" / "Tomorrow" labels on Swiss bracket slots and playoff slots. The
 * day is the VIEWER's calendar day (an IANA zone, or the runtime's own when
 * omitted), so a 06:00Z match is "tonight" in Los Angeles and "today" in
 * Singapore.
 *
 * Pure leaf: no `@/`, no React, no fetch — the verify script loads it under node.
 */

/** The calendar day of `ms` in `timeZone` (viewer's own when omitted): "YYYY-MM-DD". */
export function localDayKey(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Shift a "YYYY-MM-DD" key by whole calendar days (zone-free date math). */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export type RelativeDay = "today" | "tomorrow" | "yesterday" | null;

export function relativeDay(key: string, todayKey: string): RelativeDay {
  if (key === todayKey) return "today";
  if (key === shiftDayKey(todayKey, 1)) return "tomorrow";
  if (key === shiftDayKey(todayKey, -1)) return "yesterday";
  return null;
}
