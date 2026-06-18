/**
 * Broadcast announcements (PHA-1211 follow-up) — a curated, everyone-sees-it
 * message that rides the universal notification feed AND surfaces once as a
 * little popup. Authored in-code (like the curated NewsItem seed), so there's no
 * table and no fan-out: every signed-in player derives the same active set from
 * the clock, and "unread" is the same notificationsSeenAt watermark the rest of
 * the feed uses. No backfill — an announcement only shows between its publish and
 * expiry instants.
 *
 * Pure module (no DB / network / React). To send a new broadcast, add an entry
 * to ANNOUNCEMENTS with a publish/expiry window and ship it.
 */

import type { NotifEntry } from "./notifications-core";

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
 * The live broadcast list. Keep it short — these are deliberate, app-wide pings.
 */
export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "compare-surprise",
    icon: "📣",
    title: "Something's coming",
    body: "Check the Compare pages tomorrow once the matches go live — there's a surprise.",
    href: "/leaderboard/compare",
    publishedAt: "2026-06-18T03:00:00Z",
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

/** Active announcements as universal-feed entries (unread vs the seen watermark). */
export function announcementEntries(nowMs: number, seenAtMs: number): NotifEntry[] {
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
      isNew: atMs > seenAtMs,
    };
  });
}
