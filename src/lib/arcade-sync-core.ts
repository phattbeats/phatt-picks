/**
 * PHA-4506: Hotline -> arcade (PHATT ID progression), pure core.
 *
 * Hotline stays the source of truth for its own XP, achievements and items; it
 * derives them from picks and outcomes on every read. The arcade only needs to
 * hold the same numbers on Hotline's track. So a sync replays Hotline's WHOLE
 * derived history as signed events with deterministic ids, and the arcade's
 * `UNIQUE (game, source_ref)` / event-id dedup makes every replay a no-op.
 * There is no outbox, no "last synced" state and nothing to repair: a failed or
 * partial sync is fixed by the next one.
 *
 * What maps to what (contract: phattbeats/arcade docs/EVENTS.md):
 *   - a CLOSED day's capped XP (showing up + stages) -> `result` {score 0, xp_award}
 *   - a finished Major  -> `result` {score = Pick'Em points, rank = finish, xp_award 50}
 *   - an achievement    -> `unlock_item` achievement.<key> (arcade awards the 25 XP and the trinket)
 *   - a challenge coin  -> `item` hotline_coin_<slug>_<tier>
 *   - a charm           -> `item` hotline_charm_<key>
 * Sum on the arcade's Hotline track = Hotline's own XP, minus today's still-open day.
 *
 * Why closed days only: a day's capped XP can still grow until midnight
 * (America/New_York, the ledger's zone), and an id is accepted once. Sending
 * today would freeze a partial number.
 *
 * Event ids carry Hotline's internal player id, never the PHATT ID: event ids
 * live in the arcade's permanent record, and erasing a member must leave it
 * nameless. Hotline's own forget hook deletes the player row that id points at.
 *
 * Timestamps: the arcade refuses events older than 7 days, so history older
 * than 6 days is stamped 6 days back. The date is not lost: it is in the id.
 */

import { localDay, XP, type AchievementKey, type CharmKey, type LedgerRow } from "./progression-core";

export const GAME = "hotline";
export const EVENT_PREFIX = "hl1";
/** The arcade answers 413 above 100 NDJSON lines. */
export const MAX_LINES = 100;
const BACKDATE_MS = 6 * 864e5;
const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_RE = /^[a-z0-9_]{1,64}$/;

export interface ArcadeEvent {
  id: string;
  game: typeof GAME;
  type: "result" | "unlock_item" | "item";
  arcade_id: string;
  at: number;
  payload: Record<string, string | number>;
}

export interface SyncInput {
  /** Hotline's Player.id (cuid). */
  playerId: string;
  /** The member's PHATT ID `sub` (= arcade_id). */
  arcadeId: string;
  nowMs: number;
  ledger: readonly LedgerRow[];
  /** Finished Majors only. */
  majors: readonly { eventId: number; score: number; rank: number | null; atMs: number }[];
  unlocks: readonly { key: AchievementKey; atMs: number }[];
  coins: readonly { eventId: number; slug: string; tier: string; atMs: number }[];
  charms: readonly { key: CharmKey; atMs: number }[];
}

export const coinItem = (slug: string, tier: string) => `hotline_coin_${slug}_${tier}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
export const charmItem = (key: CharmKey) => `hotline_charm_${key}`;

/** Clamp into the arcade's accepted window: no later than now, no earlier than 6 days back. */
export const stampAt = (atMs: number, nowMs: number) => Math.min(nowMs, Math.max(atMs, nowMs - BACKDATE_MS));

export function buildArcadeEvents(s: SyncInput): ArcadeEvent[] {
  const out: ArcadeEvent[] = [];
  const push = (kind: string, ref: string | number, type: ArcadeEvent["type"], atMs: number, payload: ArcadeEvent["payload"]) => {
    const id = `${EVENT_PREFIX}-${s.playerId}-${kind}-${ref}`;
    if (!EVENT_ID_RE.test(id)) throw new Error(`arcade event id out of shape: ${id}`);
    out.push({ id, game: GAME, type, arcade_id: s.arcadeId, at: stampAt(atMs, s.nowMs), payload });
  };

  const today = localDay(s.nowMs);
  const days = new Map<string, { xp: number; atMs: number }>();
  for (const r of s.ledger) {
    if (r.source !== "showing_up" && r.source !== "stage_entered") continue;
    if (r.day >= today) continue;
    const d = days.get(r.day) ?? { xp: 0, atMs: r.atMs };
    d.xp += r.credited;
    d.atMs = Math.max(d.atMs, r.atMs);
    days.set(r.day, d);
  }
  for (const [day, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (d.xp > 0) push("d", day, "result", d.atMs, { score: 0, xp_award: d.xp, coins_delta: 0 });
  }

  for (const m of s.majors) {
    push("m", m.eventId, "result", m.atMs, {
      score: m.score,
      ...(m.rank !== null && m.rank >= 1 ? { rank: m.rank } : {}),
      xp_award: XP.majorFinished,
      coins_delta: 0,
    });
  }
  for (const u of s.unlocks) push("a", u.key, "unlock_item", u.atMs, { item: `achievement.${u.key}` });
  for (const c of s.coins) {
    const item = coinItem(c.slug, c.tier);
    if (ITEM_RE.test(item)) push("c", c.eventId, "item", c.atMs, { item });
  }
  for (const c of s.charms) push("k", c.key, "item", c.atMs, { item: charmItem(c.key) });
  return out;
}

/** NDJSON bodies of at most MAX_LINES events each. */
export function ndjsonBatches(events: readonly ArcadeEvent[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < events.length; i += MAX_LINES) out.push(events.slice(i, i + MAX_LINES).map((e) => JSON.stringify(e)).join("\n"));
  return out;
}

/** When each held charm became earned: the first unlock after which its rule holds. */
export function charmEarnedAt(
  charms: readonly { key: CharmKey; earned: (u: ReadonlySet<AchievementKey>) => boolean }[],
  unlocks: readonly { key: AchievementKey; atMs: number }[],
): { key: CharmKey; atMs: number }[] {
  const seen = new Set<AchievementKey>();
  const at = new Map<CharmKey, number>();
  for (const u of [...unlocks].sort((a, b) => a.atMs - b.atMs)) {
    seen.add(u.key);
    for (const c of charms) if (!at.has(c.key) && c.earned(seen)) at.set(c.key, u.atMs);
  }
  return charms.filter((c) => at.has(c.key)).map((c) => ({ key: c.key, atMs: at.get(c.key)! }));
}

export interface ArcadeReply {
  accepted?: number;
  duplicate?: number;
  rejected?: { id: string | null; reason: string }[];
}

/** One line for the log; `pending` = the member has not opened the arcade yet (the next sync retries). */
export function summarize(replies: readonly ArcadeReply[]) {
  const s = { accepted: 0, duplicate: 0, pending: 0, rejected: [] as { id: string | null; reason: string }[] };
  for (const r of replies) {
    s.accepted += r.accepted ?? 0;
    s.duplicate += r.duplicate ?? 0;
    for (const x of r.rejected ?? []) {
      if (x.reason === "unknown_member") s.pending++;
      else s.rejected.push(x);
    }
  }
  return s;
}
