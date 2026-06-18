/**
 * Broadcast announcements (PHA-1211 follow-up) — a curated, everyone-sees-it
 * message that rides the universal notification feed AND surfaces once as a
 * little popup. Authored in-code (like the curated NewsItem seed), so there's no
 * table and no fan-out: every signed-in player derives the same active set from
 * the clock. "Unread" is the per-item read state (PHA-1237), so an announcement
 * stays in the feed until the player opens the bell, marks it individually, or
 * marks all read. No backfill — an announcement only shows between its publish
 * and expiry instants.
 *
 * Pure module (no DB / network / React). To send a new broadcast, add an entry
 * to ANNOUNCEMENTS with a publish/expiry window and ship it.
 */

import { playoffLockTime } from "./lock-schedule-core";

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
 * The Bleachers reactions (PHA-1211) unlock the instant the playoff matches go
 * live — i.e. the bracket lock (first quarterfinal). So this one broadcast flips
 * from a teaser to a "they're live" ping AT that instant rather than being a
 * single static message (PHA-1245 follow-up): the teaser window ends exactly
 * where the live window begins, so at lock the teaser drops and a fresh
 * "Reactions are live" announcement appears (a new unread item + popup + push,
 * since it's a distinct id). Derived from the committed schedule so it stays
 * truthful if the bracket time moves; falls back to the committed first QF.
 */
const REACTIONS_LIVE_AT = playoffLockTime() ?? "2026-06-18T13:45:00Z";

/**
 * The live broadcast list. Keep it short — these are deliberate, app-wide pings.
 */
export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "compare-surprise",
    icon: "📣",
    title: "Something's coming",
    body: "Check the Compare page once the playoff matches go live — there's a surprise.",
    href: "/leaderboard/compare",
    publishedAt: "2026-06-18T03:00:00Z",
    expiresAt: REACTIONS_LIVE_AT, // teaser ends exactly when reactions unlock
  },
  {
    id: "reactions-live",
    icon: "🔥",
    title: "Reactions are live",
    body: "Drop your take on everyone's playoff picks — open the Compare page and react.",
    href: "/leaderboard/compare",
    publishedAt: REACTIONS_LIVE_AT, // unlocks the moment the bracket locks
    expiresAt: "2026-06-22T00:00:00Z",
  },
];

/** Announcements currently within their publish→expiry window, newest first. */
export function activeAnnouncements(nowMs: number): Announcement[] {
  return ANNOUNCEMENTS.filter((a) => {
    const start = Date.parse(a.publishedAt);
    const end = Date.parse(a.expiresAt);
    return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** The single most-recent active announcement (drives the one-time popup). */
export function latestActiveAnnouncement(nowMs: number): Announcement | null {
  return activeAnnouncements(nowMs)[0] ?? null;
}

/** Active announcements as universal-feed entries (no read state — the API
 *  layer applies withReadState after assembly). */
export function announcementEntries(nowMs: number): Omit<import("./notifications-core").NotifEntry, "isNew" | "readAt">[] {
  return activeAnnouncements(nowMs).map((a) => {
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
