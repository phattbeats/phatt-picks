/**
 * Pick consensus (PHA-889) — field-wide popularity of each team choice.
 *
 * Companion pick'em sites surface a consensus signal — "X% of players picked
 * this team to go 3-0 / advance / 0-3" — which drives engagement and orients
 * newcomers. phaTT already stores every Pick row, so this is pure read-side
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
 * import it directly under `node` without the Next path-alias resolver.
 */

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
