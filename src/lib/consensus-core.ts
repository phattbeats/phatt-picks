/**
 * Pick consensus (PHA-889) — field-wide popularity of each team choice.
 *
 * Companion pick'em sites surface a consensus signal — "X% of players picked
 * this team to go 3-0 / advance / 0-3" — which drives engagement and orients
 * newcomers. The app already stores every Pick row, so this is pure read-side
 * aggregation: count picks per (sectionId, groupId, slotIndex, pickId) over the
 * field that actually picked the slot, expressed as a percentage share.
 *
 * Herd-following guard: a slot's distribution is only meaningful — and only
 * rendered — AFTER its stage locks, the same no-leak discipline as reveal-core
 * (results/picks public only post-lock). This module just does the arithmetic;
 * the surfaces decide WHEN to show it and only hand in rows for resolved /
 * locked stages (see reveal/[section]/page.tsx and players/[id]/page.tsx).
 *
 * Pure module (no `@/` alias, no prisma, no fetch) so the verify script can
 * import it directly under `node` without the Next path-alias resolver. The one
 * relative import below (swiss-bucket-core) is itself such a pure module.
 */

import { bucketSwissSlots, isSwissSection } from "./swiss-bucket-core";

export interface ConsensusPickRow {
  sectionId: number;
  groupId: number;
  slotIndex: number;
  pickId: number; // team pickid from layout; 0 = TBD/unset
}

export interface ConsensusShare {
  pickId: number;
  count: number;
  pct: number; // integer 0–100, this team's share of the slot's field
}

export interface SlotConsensus {
  /** Players who made a real (non-zero) pick for this slot — the % denominator. */
  total: number;
  /** Per-team shares, most-picked first; ties broken by pickId asc for stability. */
  shares: ConsensusShare[];
}

/** Composite key — section + group + slot, matching the Pick uniqueness grain. */
export function consensusKey(sectionId: number, groupId: number, slotIndex: number): string {
  return `${sectionId}:${groupId}:${slotIndex}`;
}

/**
 * Aggregate raw Pick rows into a per-slot consensus map.
 *
 * `pickId === 0` (TBD/unset) rows are ignored — a placeholder is not a real
 * choice and would dilute every percentage. The denominator is therefore "how
 * many players actually committed a team to this slot", not the whole field.
 */
export function buildConsensus(
  picks: ReadonlyArray<ConsensusPickRow>,
): Map<string, SlotConsensus> {
  // key -> (pickId -> count)
  const counts = new Map<string, Map<number, number>>();
  for (const p of picks) {
    if (p.pickId === 0) continue;
    const key = consensusKey(p.sectionId, p.groupId, p.slotIndex);
    let byPick = counts.get(key);
    if (!byPick) counts.set(key, (byPick = new Map()));
    byPick.set(p.pickId, (byPick.get(p.pickId) ?? 0) + 1);
  }

  const out = new Map<string, SlotConsensus>();
  for (const [key, byPick] of counts) {
    let total = 0;
    for (const c of byPick.values()) total += c;
    const shares: ConsensusShare[] = [...byPick.entries()]
      .map(([pickId, count]) => ({ pickId, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count || a.pickId - b.pickId);
    out.set(key, { total, shares });
  }
  return out;
}

/**
 * Share for one specific team in a slot, or null if that slot has no picks (or
 * nobody chose that team). Lets a surface answer "what % of the field made the
 * SAME pick I did" without re-scanning the shares array.
 */
export function shareFor(
  consensus: ReadonlyMap<string, SlotConsensus>,
  sectionId: number,
  groupId: number,
  slotIndex: number,
  pickId: number,
): ConsensusShare | null {
  if (pickId === 0) return null;
  const slot = consensus.get(consensusKey(sectionId, groupId, slotIndex));
  if (!slot) return null;
  return slot.shares.find((s) => s.pickId === pickId) ?? null;
}

/* ── Bucket-level consensus (PHA-900 follow-up) ───────────────────────────────
 *
 * Per-slot consensus (above) asks "who else put this team in THIS exact slot".
 * Inside a Swiss stage that's the wrong grain: the 3:0 slots are equivalent to
 * each other, the advancing slots are equivalent, and the 0:3 slots are
 * equivalent. Thunder Down Under was nearly everyone's 0:3 pick, but because
 * people placed them in different 0:3 slots, per-slot consensus called it a
 * "lone call". So the profile's consensus line measures agreement per BUCKET:
 * "who else called this team to go 0:3", regardless of which 0:3 slot they used.
 *
 * Two differences from the per-slot map:
 *   1. Swiss slots collapse to their bucket (3:0 / advancing / 0:3); non-Swiss
 *      (playoff) matches stay per-slot — each match is its own distinct call.
 *   2. The denominator is DISTINCT PLAYERS, not pick rows: a player fills 2
 *      slots in the 0:3 bucket, so counting rows would double everything and
 *      "whole board" could never trigger. A team is unique per group, so a
 *      player contributes at most one row per (bucket, team) — distinct-player
 *      counts are exact.
 */

export interface BucketPickRow extends ConsensusPickRow {
  playerId: string;
}

export interface BucketShare {
  /** Distinct players who put this team anywhere in this bucket. */
  count: number;
  /** Distinct players who made any real pick in this bucket — the denominator. */
  total: number;
}

export interface BucketConsensus {
  total: Set<string>;
  byTeam: Map<number, Set<string>>;
}

// Swiss is always the 10-slot 2/6/2 format; bucketSwissSlots(10) is the split.
const SWISS_BUCKETS = bucketSwissSlots(10);

/** The consensus grain for a slot: a Swiss bucket id, else the slot itself. */
function bucketGrain(sectionId: number, slotIndex: number): string {
  if (!isSwissSection(sectionId)) return `s${slotIndex}`;
  const i = SWISS_BUCKETS.findIndex((b) => b.slotIndexes.includes(slotIndex));
  return i >= 0 ? `b${i}` : `s${slotIndex}`;
}

/** Composite key at bucket grain — section + group + (bucket | slot). */
function bucketConsensusKey(sectionId: number, groupId: number, slotIndex: number): string {
  return `${sectionId}:${groupId}:${bucketGrain(sectionId, slotIndex)}`;
}

/** Aggregate Pick rows into a per-bucket, distinct-player consensus map. */
export function buildBucketConsensus(
  picks: ReadonlyArray<BucketPickRow>,
): Map<string, BucketConsensus> {
  const out = new Map<string, BucketConsensus>();
  for (const p of picks) {
    if (p.pickId === 0) continue;
    const key = bucketConsensusKey(p.sectionId, p.groupId, p.slotIndex);
    let e = out.get(key);
    if (!e) out.set(key, (e = { total: new Set(), byTeam: new Map() }));
    e.total.add(p.playerId);
    let team = e.byTeam.get(p.pickId);
    if (!team) e.byTeam.set(p.pickId, (team = new Set()));
    team.add(p.playerId);
  }
  return out;
}

/**
 * How many players made the SAME bucket call (team → bucket) as this pick, over
 * how many filled the bucket. null for an unset team or an untouched bucket.
 */
export function bucketShareFor(
  consensus: ReadonlyMap<string, BucketConsensus>,
  sectionId: number,
  groupId: number,
  slotIndex: number,
  pickId: number,
): BucketShare | null {
  if (pickId === 0) return null;
  const e = consensus.get(bucketConsensusKey(sectionId, groupId, slotIndex));
  if (!e) return null;
  const team = e.byTeam.get(pickId);
  if (!team) return null;
  return { count: team.size, total: e.total.size };
}
