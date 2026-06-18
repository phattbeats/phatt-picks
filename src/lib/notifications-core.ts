/**
 * Universal in-app notifications (PHA-1211 follow-up).
 *
 * One feed, several kinds — reactions on your picks, upcoming stage locks, and
 * "your recap is ready". All are DERIVED from the clock + committed data + live
 * rows; there is no Notification table and no fan-out writes. "Unread" is simply
 * whatever became relevant after the player's `notificationsSeenAt` watermark,
 * so the system never backfills: a stage that already locked, or a recap from a
 * past major, has its relevance timestamp in the past and (once seen) drops out
 * of the unread count.
 *
 * Pure module (no DB / network / React). The API route gathers the inputs
 * (reaction rows, lock times, the latest resolved stage) and feeds them to these
 * builders; the grouping, phrasing and unread math live here so they unit-test
 * in isolation.
 *
 * NOTE: per-match start times are deliberately not in the committed data (the
 * playoff schedule is TBD until seeding closes), so there is no "match starts in
 * Yh" kind yet — that's a follow-up gated on a real match-schedule source.
 */

import { getStamp } from "./bleachers-core";
import { humanizeLockEta, DEFAULT_REMINDER_OFFSETS_MS } from "./notify-core";

export type NotifKind = "reaction" | "stage" | "recap" | "announcement";

export interface NotifStamp {
  id: string;
  glyph: string;
  label: string;
  kind: "props" | "heat";
  count: number;
}

export interface NotifEntry {
  /** stable id (dedup + React key), e.g. "reaction:108:276:0" / "stage:107". */
  id: string;
  kind: NotifKind;
  icon: string;
  title: string;
  body: string;
  href: string;
  /** when this became relevant, epoch ms — drives sort + unread. */
  atMs: number;
  isNew: boolean;
  /** reaction kind only: the stamp tally for rich rendering. */
  stamps?: NotifStamp[];
}

export interface FeedView {
  unread: number;
  items: NotifEntry[];
}

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_LIMIT = 30;

// ── REACTIONS ──────────────────────────────────────────────────────────────

export interface NotifReaction {
  stampId: string;
  sectionId: number;
  groupId: number;
  slotIndex: number;
  createdAtMs: number;
}

interface ReactionGroup {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  stamps: NotifStamp[];
  total: number;
  latestAtMs: number;
  newCount: number;
}

/** Group a player's inbound reactions by the pick they landed on. */
function groupReactions(rows: readonly NotifReaction[], seenAtMs: number): ReactionGroup[] {
  const groups = new Map<string, { sectionId: number; groupId: number; slotIndex: number; counts: Map<string, number>; latestAtMs: number; newCount: number }>();
  for (const r of rows) {
    if (!getStamp(r.stampId)) continue;
    const key = `${r.sectionId}:${r.groupId}:${r.slotIndex}`;
    let g = groups.get(key);
    if (!g) {
      g = { sectionId: r.sectionId, groupId: r.groupId, slotIndex: r.slotIndex, counts: new Map(), latestAtMs: 0, newCount: 0 };
      groups.set(key, g);
    }
    g.counts.set(r.stampId, (g.counts.get(r.stampId) ?? 0) + 1);
    if (r.createdAtMs > g.latestAtMs) g.latestAtMs = r.createdAtMs;
    if (r.createdAtMs > seenAtMs) g.newCount += 1;
  }
  return [...groups.values()].map((g) => {
    const stamps: NotifStamp[] = [...g.counts.entries()]
      .map(([id, count]) => {
        const s = getStamp(id)!;
        return { id: s.id, glyph: s.glyph, label: s.label, kind: s.kind, count };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
      sectionId: g.sectionId,
      groupId: g.groupId,
      slotIndex: g.slotIndex,
      stamps,
      total: stamps.reduce((n, s) => n + s.count, 0),
      latestAtMs: g.latestAtMs,
      newCount: g.newCount,
    };
  });
}

/** Resolve a pick group → display strings (team the viewer picked + stage). */
export type PickLabeller = (sectionId: number, groupId: number, slotIndex: number) => { teamName: string | null; stageLabel: string };

/** Reaction notifications: one entry per pick that got reactions. */
export function reactionEntries(
  rows: readonly NotifReaction[],
  seenAtMs: number,
  label: PickLabeller,
): NotifEntry[] {
  return groupReactions(rows, seenAtMs).map((g) => {
    const { teamName, stageLabel } = label(g.sectionId, g.groupId, g.slotIndex);
    const who = teamName ?? "your pick";
    const stage = stageLabel ? `${stageLabel} ` : "";
    return {
      id: `reaction:${g.sectionId}:${g.groupId}:${g.slotIndex}`,
      kind: "reaction" as const,
      icon: g.stamps[0]?.glyph ?? "💬",
      title: who,
      body: `${g.total} reaction${g.total === 1 ? "" : "s"} on your ${stage}pick`,
      href: "/picks",
      atMs: g.latestAtMs,
      isNew: g.newCount > 0,
      stamps: g.stamps,
    };
  });
}

// ── STAGE LOCKS (upcoming) ───────────────────────────────────────────────────

export interface StageLockInput {
  sectionId: number;
  stageName: string;
  /** published lock instant, epoch ms. */
  lockAtMs: number;
}

/**
 * "Stage X picks lock in Yh" — only for stages whose lock is still in the future
 * AND already within the lead window (so we don't surface stages weeks out).
 * Returns null otherwise (passed lock / too far out = no backfill).
 *
 * `atMs` (which drives unread) is the most recent reminder threshold the clock
 * has crossed — lock − 24h, then lock − 1h (the same cadence as the push
 * reminders) — falling back to when the entry first appeared (lock − lead). So
 * the notification re-surfaces as unread at the 24h and 1h marks, then goes
 * quiet once the player opens the panel.
 */
export function stageLockEntry(
  input: StageLockInput,
  nowMs: number,
  seenAtMs: number,
  leadMs: number = 7 * DAY_MS,
): NotifEntry | null {
  const { sectionId, stageName, lockAtMs } = input;
  if (!Number.isFinite(lockAtMs)) return null;
  if (lockAtMs <= nowMs) return null; // already locked — not upcoming
  const appearedAtMs = lockAtMs - leadMs;
  if (nowMs < appearedAtMs) return null; // too far out to surface yet
  const crossed = DEFAULT_REMINDER_OFFSETS_MS
    .map((o) => lockAtMs - o)
    .filter((t) => t <= nowMs);
  const atMs = Math.max(appearedAtMs, ...crossed);
  return {
    id: `stage:${sectionId}`,
    kind: "stage",
    icon: "⏰",
    title: `${stageName} locks soon`,
    body: `Picks lock in ${humanizeLockEta(lockAtMs - nowMs)} — get yours in.`,
    href: "/picks",
    atMs,
    isNew: atMs > seenAtMs,
  };
}

// ── RECAP READY ──────────────────────────────────────────────────────────────

export interface RecapInput {
  sectionId: number;
  stageName: string;
  resolvedAtMs: number;
}

/**
 * "Your {Stage} recap is ready" for the latest resolved+authored stage. Capped
 * at maxAgeMs so a stale recap from a past major never backfills the feed.
 */
export function recapEntry(
  input: RecapInput,
  nowMs: number,
  seenAtMs: number,
  maxAgeMs: number = 14 * DAY_MS,
): NotifEntry | null {
  const { sectionId, stageName, resolvedAtMs } = input;
  if (!Number.isFinite(resolvedAtMs)) return null;
  if (nowMs - resolvedAtMs > maxAgeMs) return null; // too old — no backfill
  return {
    id: `recap:${sectionId}`,
    kind: "recap",
    icon: "🎬",
    title: `${stageName} recap`,
    body: "Your stage recap is ready — see how you stacked up.",
    href: "/",
    atMs: resolvedAtMs,
    isNew: resolvedAtMs > seenAtMs,
  };
}

// ── ASSEMBLY ─────────────────────────────────────────────────────────────────

/**
 * Merge all notification kinds into one feed: unread (new) first, then most
 * recent; unread = count of entries newer than the seen watermark. Capped.
 */
export function assembleFeed(entries: readonly NotifEntry[], limit: number = DEFAULT_LIMIT): FeedView {
  const items = [...entries].sort(
    (a, b) => Number(b.isNew) - Number(a.isNew) || b.atMs - a.atMs,
  );
  const unread = items.reduce((n, e) => n + (e.isNew ? 1 : 0), 0);
  return { unread, items: items.slice(0, limit) };
}
