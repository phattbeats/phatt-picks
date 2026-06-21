/**
 * Universal in-app notifications (PHA-1211 follow-up; per-notification read
 * state added in PHA-1237).
 *
 * One feed, several kinds — reactions on your picks, upcoming stage locks,
 * recaps, and broadcast announcements. All are DERIVED from the clock +
 * committed data + live rows; there is no Notification table and no fan-out
 * writes. "Unread" is the union of two sources, both supplied by the API
 * route via ReadContext:
 *   - the legacy `notificationsSeenAt` watermark (cheap bulk-clear on
 *     bell open; still works for entries that pre-date the read table)
 *   - the per-entry NotificationRead set (PHA-1237) — explicit dismissals
 *     that survive across the bell and the /notifications inbox
 *
 * Either source marking an entry read is sufficient; the explicit set is the
 * source of truth when present (an explicit read beats the watermark, even
 * if the watermark would have still said "unread"). Reaction-kind entries
 * re-merge on a per-pick basis — when a new reaction arrives on a previously
 * read pick, the API route re-sorts the entry's atMs to the latest reaction
 * (so the per-entry read row is naturally older than the new atMs and the
 * entry resurfaces as unread).
 *
 * Pure module (no DB / network / React). The API route gathers the inputs
 * (reaction rows, lock times, the latest resolved stage, NotificationRead
 * rows) and feeds them to these builders; the grouping, phrasing, read-state
 * math, unread filtering, and limit all live here so they unit-test in
 * isolation.
 *
 * NOTE: per-match start times are deliberately not in the committed data (the
 * playoff schedule is TBD until seeding closes), so there is no "match starts in
 * Yh" kind yet — that's a follow-up gated on a real match-schedule source.
 */

import { getStamp } from "./bleachers-core";
import { humanizeLockEta, DEFAULT_REMINDER_OFFSETS_MS } from "./notify-core";
import type { CoinTier } from "./challenge-coin-core";

export type NotifKind = "reaction" | "stage" | "recap" | "announcement" | "coin";

// ── NOTIFICATION PREFERENCES (PHA-1240) ──────────────────────────────────────

export interface NotifTypePrefs {
  inApp: boolean;
  push: boolean;
}

/** Per-type channel preferences stored as JSON in Player.notifPrefs. */
export interface NotifPrefs {
  reactions: NotifTypePrefs;
  stage: NotifTypePrefs;
  recap: NotifTypePrefs;
  announce: NotifTypePrefs;
  coin: NotifTypePrefs;
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  reactions: { inApp: true, push: false },
  stage:     { inApp: true, push: true },
  recap:     { inApp: true, push: false },
  announce:  { inApp: true, push: false },
  // Earning a Major coin is a rare, celebratory moment — push on by default so
  // it "pings" (PHA-1278, Brandon).
  coin:      { inApp: true, push: true },
};

/** Parse and normalise Player.notifPrefs JSON. Missing keys fall back to defaults. */
export function parseNotifPrefs(json: string | null | undefined): NotifPrefs {
  if (!json) return DEFAULT_NOTIF_PREFS;
  try {
    const p = JSON.parse(json) as Partial<NotifPrefs>;
    return {
      reactions: { ...DEFAULT_NOTIF_PREFS.reactions, ...(p.reactions ?? {}) },
      stage:     { ...DEFAULT_NOTIF_PREFS.stage,     ...(p.stage ?? {}) },
      recap:     { ...DEFAULT_NOTIF_PREFS.recap,      ...(p.recap ?? {}) },
      announce:  { ...DEFAULT_NOTIF_PREFS.announce,  ...(p.announce ?? {}) },
      coin:      { ...DEFAULT_NOTIF_PREFS.coin,       ...(p.coin ?? {}) },
    };
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

/** Filter raw entries to those the player has enabled in-app. */
export function filterEntriesByPrefs(
  entries: readonly Omit<NotifEntry, "isNew" | "readAt">[],
  prefs: NotifPrefs,
): Omit<NotifEntry, "isNew" | "readAt">[] {
  return entries.filter((e) => {
    if (e.kind === "reaction")     return prefs.reactions.inApp;
    if (e.kind === "stage")        return prefs.stage.inApp;
    if (e.kind === "recap")        return prefs.recap.inApp;
    if (e.kind === "announcement") return prefs.announce.inApp;
    if (e.kind === "coin")         return prefs.coin.inApp;
    return true;
  });
}

export interface NotifStamp {
  id: string;
  glyph: string;
  label: string;
  kind: "props" | "heat";
  count: number;
}

/** A raw feed entry as built by the per-kind builders. The `id` is stable
 *  (used for React keys + per-entry read state) and `atMs` is when this
 *  particular instance became relevant (drives sort + re-emergence). */
export interface NotifEntry {
  /** stable id (dedup + React key + per-entry read key), e.g.
   *  "reaction:108:276:0" / "stage:107" / "recap:106" /
   *  "announce:compare-surprise". */
  id: string;
  kind: NotifKind;
  icon: string;
  title: string;
  body: string;
  href: string;
  /** when this became relevant, epoch ms — drives sort + unread. */
  atMs: number;
  isNew: boolean;
  /**
   * When the player explicitly marked this read (PHA-1237). Null when the
   * item is "read" only via the bulk watermark (implicit). Defaults to null
   * for builder output; `withReadState` fills it from the read context.
   */
  readAt?: number | null;
  /** reaction kind only: the stamp tally for rich rendering. */
  stamps?: NotifStamp[];
}

export interface FeedView {
  unread: number;
  items: NotifEntry[];
  /** total entries available (pre-limit) — drives the inbox page's "showing N
   *  of M" copy and the bell's "see all" affordance. */
  total: number;
  /** when the request was assembled, epoch ms. */
  generatedAtMs: number;
}

/**
 * PHA-1237 read context. `readSet` is the player's set of explicitly-read
 * entry ids (NotificationRead rows whose readAt is at or after the entry's
 * atMs). `readAtByEntry` carries the actual readAt epoch ms so the assembled
 * entry can surface "read at 14:32 yesterday". `seenAtMs` is the player's
 * last notificationsSeenAt watermark — entries older than this are
 * implicitly read. Either is sufficient to mark an item read; the explicit
 * set is the source of truth.
 */
export interface ReadContext {
  seenAtMs: number;
  readSet: ReadonlySet<string>;
  /** epoch ms of each explicit read, keyed by entryId — drives readAt. */
  readAtByEntry: ReadonlyMap<string, number>;
}

export function emptyReadContext(seenAtMs: number = 0): ReadContext {
  return { seenAtMs, readSet: new Set(), readAtByEntry: new Map() };
}

/** True if the player has read this entry (explicit OR via watermark). The
 *  explicit read is "stale" (the entry has moved on since they read it) when
 *  readAt < entry.atMs — in that case the entry re-surfaces as unread. The
 *  reaction kind relies on this so a new reaction on a previously-read pick
 *  reappears. */
export function isRead(entry: Pick<NotifEntry, "id" | "atMs">, rc: ReadContext): boolean {
  if (rc.readSet.has(entry.id)) {
    const explicit = rc.readAtByEntry.get(entry.id);
    // When a timestamp is available, check re-emergence: a new reaction on a
    // previously-read pick has atMs > readAt, so it resurfaces as unread.
    // Without a timestamp (readSet-only), trust the membership.
    if (explicit === undefined || explicit >= entry.atMs) return true;
    // Stale read — the entry re-emerged after the read was recorded.
  }
  if (rc.seenAtMs > 0 && entry.atMs <= rc.seenAtMs) return true;
  return false;
}

/** Compute the assembled NotifEntry shape given a raw builder result and the
 *  read context. The result has its `isNew` and `readAt` derived from the
 *  ReadContext. `readAt` is the actual read row timestamp when the explicit
 *  read is still "fresh" (>= entry.atMs); null otherwise — clients should
 *  surface a "read at <time>" hint only when readAt is non-null. */
export function withReadState(
  raw: Omit<NotifEntry, "isNew" | "readAt">,
  rc: ReadContext,
): NotifEntry {
  const explicit = rc.readAtByEntry.get(raw.id);
  const explicitFresh = explicit !== undefined && explicit >= raw.atMs;
  const readByExplicit = explicitFresh;
  const readByWatermark = rc.seenAtMs > 0 && raw.atMs <= rc.seenAtMs;
  return {
    ...raw,
    isNew: !(readByExplicit || readByWatermark),
    readAt: explicitFresh ? explicit! : null,
  };
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
}

/** Group a player's inbound reactions by the pick they landed on. */
function groupReactions(rows: readonly NotifReaction[]): ReactionGroup[] {
  const groups = new Map<string, { sectionId: number; groupId: number; slotIndex: number; counts: Map<string, number>; latestAtMs: number }>();
  for (const r of rows) {
    if (!getStamp(r.stampId)) continue;
    const key = `${r.sectionId}:${r.groupId}:${r.slotIndex}`;
    let g = groups.get(key);
    if (!g) {
      g = { sectionId: r.sectionId, groupId: r.groupId, slotIndex: r.slotIndex, counts: new Map(), latestAtMs: 0 };
      groups.set(key, g);
    }
    g.counts.set(r.stampId, (g.counts.get(r.stampId) ?? 0) + 1);
    if (r.createdAtMs > g.latestAtMs) g.latestAtMs = r.createdAtMs;
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
    };
  });
}

/** Resolve a pick group → display strings (team the viewer picked + stage). */
export type PickLabeller = (sectionId: number, groupId: number, slotIndex: number) => { teamName: string | null; stageLabel: string };

/** Reaction notifications: one entry per pick that got reactions. */
export function reactionEntries(
  rows: readonly NotifReaction[],
  label: PickLabeller,
): Omit<NotifEntry, "isNew" | "readAt">[] {
  return groupReactions(rows).map((g) => {
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
  leadMs: number = 7 * DAY_MS,
): Omit<NotifEntry, "isNew" | "readAt"> | null {
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
  maxAgeMs: number = 14 * DAY_MS,
): Omit<NotifEntry, "isNew" | "readAt"> | null {
  const { sectionId, stageName, resolvedAtMs } = input;
  if (!Number.isFinite(resolvedAtMs)) return null;
  if (nowMs - resolvedAtMs > maxAgeMs) return null; // too old — no backfill
  return {
    id: `recap:${sectionId}`,
    kind: "recap",
    icon: "🎬",
    title: `${stageName} recap`,
    body: "Your stage recap is ready — see how you stacked up.",
    // Deep-link to the stage's own reveal page (the actual recap), with
    // ?wrapped=1 so the cinematic deck re-opens even on a device that already
    // dismissed the once-per-stage auto-popup (PHA-1245 follow-up). Landing on
    // "/" did nothing once the localStorage seen-flag was set.
    href: `/reveal/${sectionId}?wrapped=1`,
    atMs: resolvedAtMs,
  };
}

// ── CHALLENGE COIN EARNED (PHA-1278) ─────────────────────────────────────────

export interface CoinEarnedInput {
  eventId: number;
  eventName: string;
  tier: CoinTier;
  /** Archive instant the coin minted at, epoch ms. */
  earnedAtMs: number;
}

const TIER_LABEL: Record<CoinTier, string> = {
  diamond: "Diamond",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};

/**
 * "You earned the {Major} challenge coin" — minted when a Major concludes and
 * the player took part (PHA-1278). Capped at maxAgeMs so an old coin never
 * backfills the feed long after it was earned (the coin itself lives forever on
 * the shelf; only the notification is time-bound). `href` lands on the Majors
 * page where the coin sits in its velvet case, ready to inspect.
 */
export function coinEarnedEntry(
  input: CoinEarnedInput,
  nowMs: number,
  maxAgeMs: number = 30 * DAY_MS,
): Omit<NotifEntry, "isNew" | "readAt"> | null {
  const { eventId, eventName, tier, earnedAtMs } = input;
  if (!Number.isFinite(earnedAtMs)) return null;
  if (nowMs - earnedAtMs > maxAgeMs) return null; // too old — no backfill
  return {
    id: `coin:${eventId}`,
    kind: "coin",
    icon: "🪙",
    title: `${TIER_LABEL[tier]} challenge coin earned`,
    body: `Your ${eventName} challenge coin is ready — tap to inspect it.`,
    href: "/majors",
    atMs: earnedAtMs,
  };
}

// ── ASSEMBLY ─────────────────────────────────────────────────────────────────

/**
 * Merge all notification kinds into one feed: unread (new) first, then most
 * recent. Read state is applied from the ReadContext (PHA-1237). Capped at
 * `limit` items; the caller gets `total` to know how many were available
 * before slicing (drives the "See all" badge on the bell + the "showing N of
 * M" copy on the inbox page).
 */
export function assembleFeed(
  rawEntries: readonly Omit<NotifEntry, "isNew" | "readAt">[],
  rc: ReadContext,
  limit: number = DEFAULT_LIMIT,
  nowMs: number = Date.now(),
): FeedView {
  // Apply read state first; sort and slice after. Stable secondary order on
  // atMs keeps tie-breaks deterministic across the bell and the inbox page.
  const items: NotifEntry[] = rawEntries.map((r) => withReadState(r, rc));
  items.sort(
    (a, b) => Number(b.isNew) - Number(a.isNew) || b.atMs - a.atMs || a.id.localeCompare(b.id),
  );
  const unread = items.reduce((n, e) => n + (e.isNew ? 1 : 0), 0);
  return {
    unread,
    total: items.length,
    generatedAtMs: nowMs,
    items: items.slice(0, Math.max(0, limit)),
  };
}
