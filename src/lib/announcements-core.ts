/**
 * Broadcast announcements (#1211 follow-up) — a curated, everyone-sees-it
 * message that rides the universal notification feed AND surfaces once as a
 * little popup. Authored in-code (like the curated NewsItem seed), so there's no
 * table and no fan-out: every signed-in player derives the same active set from
 * the clock. "Unread" is the per-item read state (#1237), so an announcement
 * stays in the feed until the player opens the bell, marks it individually, or
 * marks all read. No backfill — an announcement only shows between its publish
 * and expiry instants.
 *
 * Pure module (no DB / network / React). To send a new broadcast, add an entry
 * to ANNOUNCEMENTS with a publish/expiry window and ship it.
 */

import { playoffLockTime } from "./lock-schedule-core";
import { currentEvent, playoffSectionIdsFor, type EventConfig } from "./events-core";

export interface Announcement {
  id: string;
  icon: string;
  title: string;
  body: string;
  href: string;
  /** ISO-8601 UTC — when it starts showing. */
  publishedAt: string;
  /** ISO-8601 UTC — when it stops showing. */
  expiresAt: string;
}

/**
 * The Bleachers reactions (#1211) unlock the instant the playoff matches go
 * live — i.e. the bracket lock (first quarterfinal). So this one broadcast flips
 * from a teaser to a "they're live" ping AT that instant rather than being a
 * single static message (#1245 follow-up): the teaser window ends exactly
 * where the live window begins, so at lock the teaser drops and a fresh
 * "Reactions are live" announcement appears (a new unread item + popup + push,
 * since it's a distinct id). All three instants derive from the ACTIVE event's
 * registry (#1327: resolved per call via `currentEvent`, never cached at module
 * load). PHA-5275: no Cologne fallback — an event whose bracket isn't scheduled
 * yet simply has no reactions broadcast.
 */
const TEASER_LEAD_MS = 12 * 3_600_000;

function reactionsWindow(event: EventConfig): Record<string, string> | null {
  const lock = playoffLockTime(event.lockSchedule, playoffSectionIdsFor(event));
  if (!lock) return null;
  // Live until the UTC midnight after the last playoff game (Cologne: GF Jun 21 → Jun 22 00:00Z).
  const games = Object.values(event.playoffSchedule).flat().map(Date.parse).filter(Number.isFinite);
  const last = games.length ? Math.max(...games) : Date.parse(event.dates.end);
  const end = new Date(last);
  end.setUTCHours(24, 0, 0, 0);
  return {
    [TEASER_START]: new Date(Date.parse(lock) - TEASER_LEAD_MS).toISOString().replace(".000Z", "Z"),
    [REACTIONS_LIVE_AT]: lock,
    [REACTIONS_END]: end.toISOString().replace(".000Z", "Z"),
  };
}

/** Placeholders swapped for the active event's reactions window at read time (see below). */
const TEASER_START = "__TEASER_START__";
const REACTIONS_LIVE_AT = "__REACTIONS_LIVE_AT__";
const REACTIONS_END = "__REACTIONS_END__";

/**
 * The live broadcast list. Keep it short — these are deliberate, app-wide pings.
 */
export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "teams-locked-singapore",
    icon: "🔒",
    title: "TEAMS LOCKED",
    body: "All 32 teams for PGL Major Singapore are set. The field is on the home page.",
    href: "/",
    publishedAt: "2026-11-03T13:45:00Z",
    expiresAt: "2026-11-27T00:00:00Z",
  },
  {
    id: "compare-surprise",
    icon: "📣",
    title: "Something's coming",
    body: "Check the Compare page once the playoff matches go live — there's a surprise.",
    href: "/leaderboard/compare",
    publishedAt: TEASER_START,
    expiresAt: REACTIONS_LIVE_AT, // teaser ends exactly when reactions unlock
  },
  {
    id: "reactions-live",
    icon: "🔥",
    title: "Reactions are live",
    body: "Drop your take on everyone's playoff picks — open the Compare page and react.",
    href: "/leaderboard/compare",
    publishedAt: REACTIONS_LIVE_AT, // unlocks the moment the bracket locks
    expiresAt: REACTIONS_END,
  },
];

/** Announcements currently within their publish→expiry window, newest first. */
export function activeAnnouncements(nowMs: number, event: EventConfig = currentEvent(nowMs)): Announcement[] {
  const window = reactionsWindow(event) ?? {};
  const resolve = (v: string) => (v.startsWith("__") ? window[v] ?? "" : v);
  return ANNOUNCEMENTS.map((a) => ({
    ...a,
    publishedAt: resolve(a.publishedAt),
    expiresAt: resolve(a.expiresAt),
  })).filter((a) => {
    const start = Date.parse(a.publishedAt);
    const end = Date.parse(a.expiresAt);
    return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** The single most-recent active announcement (drives the one-time popup). */
export function latestActiveAnnouncement(nowMs: number, event: EventConfig = currentEvent(nowMs)): Announcement | null {
  return activeAnnouncements(nowMs, event)[0] ?? null;
}

/** Active announcements as universal-feed entries (no read state — the API
 *  layer applies withReadState after assembly). */
export function announcementEntries(
  nowMs: number,
  event: EventConfig = currentEvent(nowMs),
): Omit<import("./notifications-core").NotifEntry, "isNew" | "readAt">[] {
  return activeAnnouncements(nowMs, event).map((a) => {
    const atMs = Date.parse(a.publishedAt);
    return {
      id: `announce:${a.id}`,
      kind: "announcement" as const,
      icon: a.icon,
      title: a.title,
      body: a.body,
      href: a.href,
      atMs,
    };
  });
}
