/**
 * Bleachers notifications (PHA-1211 follow-up) — turn the raw Reaction rows that
 * landed on a player's picks into an in-app notification feed: an unread count
 * for the header bell badge, plus grouped items ("🔥×3 · 🧊×1 on your Spirit
 * pick") for the dropdown.
 *
 * Derived, not stored: there is no Notification table. "Unread" is simply the
 * reactions newer than the player's `reactionsSeenAt` watermark (set when they
 * open the bell). This mirrors how consensus / standings are read-side derived —
 * one source of truth (Reaction rows), no fan-out writes to drift.
 *
 * Pure module (no DB / network / React). The API route resolves team names and
 * stage labels from the layout and feeds rows in here; the grouping, tally and
 * unread math live here so they can be unit-tested in isolation.
 */

import { getStamp, pickTargetKey, type Stamp } from "./bleachers-core";

export interface NotifReaction {
  stampId: string;
  sectionId: number;
  groupId: number;
  slotIndex: number;
  /** epoch ms — Reaction.createdAt. */
  createdAtMs: number;
}

export interface NotifStamp {
  id: string;
  glyph: string;
  label: string;
  kind: Stamp["kind"];
  count: number;
}

export interface NotifItem {
  key: string;
  sectionId: number;
  groupId: number;
  slotIndex: number;
  stamps: NotifStamp[];
  total: number;
  /** newest reaction in this group, epoch ms — drives sort + "time ago". */
  latestAtMs: number;
  /** at least one reaction in this group is newer than the seen watermark. */
  hasNew: boolean;
  /** count of reactions in this group newer than the watermark. */
  newCount: number;
}

export interface NotificationsView {
  /** total reactions newer than the watermark — the bell badge number. */
  unread: number;
  items: NotifItem[];
}

const DEFAULT_LIMIT = 30;

/**
 * Group a player's inbound reactions by the pick they landed on.
 *
 * - `unread` counts individual reactions newer than `seenAtMs` (badge number).
 * - Items are grouped by (section, group, slot), each carrying a stamp tally in
 *   canonical STAMPS order, the newest timestamp, and how many are unread.
 * - Sorted newest-activity-first; items with unread reactions always sort above
 *   fully-read ones so fresh heat leads. Capped at `limit`.
 * - Unknown stampIds (a retired glyph) are skipped, never rendered blank.
 */
export function buildNotifications(
  rows: readonly NotifReaction[],
  seenAtMs: number,
  limit: number = DEFAULT_LIMIT,
): NotificationsView {
  const groups = new Map<
    string,
    {
      sectionId: number;
      groupId: number;
      slotIndex: number;
      counts: Map<string, number>;
      latestAtMs: number;
      newCount: number;
    }
  >();

  let unread = 0;
  for (const r of rows) {
    if (!getStamp(r.stampId)) continue;
    const isNew = r.createdAtMs > seenAtMs;
    if (isNew) unread += 1;
    const key = pickTargetKey(r.sectionId, r.groupId, r.slotIndex);
    let g = groups.get(key);
    if (!g) {
      g = {
        sectionId: r.sectionId,
        groupId: r.groupId,
        slotIndex: r.slotIndex,
        counts: new Map(),
        latestAtMs: 0,
        newCount: 0,
      };
      groups.set(key, g);
    }
    g.counts.set(r.stampId, (g.counts.get(r.stampId) ?? 0) + 1);
    if (r.createdAtMs > g.latestAtMs) g.latestAtMs = r.createdAtMs;
    if (isNew) g.newCount += 1;
  }

  const items: NotifItem[] = [...groups.entries()].map(([key, g]) => {
    const stamps: NotifStamp[] = [...g.counts.entries()]
      .map(([id, count]) => {
        const s = getStamp(id)!;
        return { id: s.id, glyph: s.glyph, label: s.label, kind: s.kind, count };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const total = stamps.reduce((n, s) => n + s.count, 0);
    return {
      key,
      sectionId: g.sectionId,
      groupId: g.groupId,
      slotIndex: g.slotIndex,
      stamps,
      total,
      latestAtMs: g.latestAtMs,
      hasNew: g.newCount > 0,
      newCount: g.newCount,
    };
  });

  // Unread groups first, then most-recent activity.
  items.sort(
    (a, b) =>
      Number(b.hasNew) - Number(a.hasNew) || b.latestAtMs - a.latestAtMs,
  );

  return { unread, items: items.slice(0, limit) };
}
