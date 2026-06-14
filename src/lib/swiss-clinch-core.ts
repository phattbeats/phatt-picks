/**
 * Swiss clinch → pick-bucket resolver (pure, PHA-918).
 *
 * The leaderboard scores against StageOutcome (the resolved answer key). Valve's
 * GetTournamentLayout returns SET-valued pickids per Swiss slot (every team that
 * could fill the bucket), which the oracle leaves "ambiguous" (outcomes-core) —
 * so a Swiss stage never resolves there and the board sits at zero even after
 * teams clinch. The live HLTV standings (already crawled hourly for the picks-
 * page bracket, PHA-902) DO carry each team's terminal W-L record, which is
 * exactly the bucket it clinched. This module is the pure seam that turns those
 * records into StageOutcome rows.
 *
 * Given the live standings (team pickid + W-L) and the layout's Swiss bucket
 * convention, it decides which teams have TERMINALLY clinched a PICK bucket
 * (3:0 / 3:1-3:2 advance / 0:3) and assigns each to a free slot of that bucket.
 * Slot choice within a bucket is arbitrary-but-stable — the slots are
 * interchangeable and the bucket-aware scorer (scoring.ts) compares them as sets
 * — and it NEVER rewrites an already-filled slot, so the output is terminal and
 * idempotent: re-running after more teams clinch only appends the new ones.
 *
 * TRUTHFUL BY CONSTRUCTION: only a TERMINAL record clinches a pick bucket (3 wins
 * or 3 losses). A team still playing — or eliminated at 1:3 / 2:3, which is OUT
 * but is not the 0:3 PICK bucket — is left unresolved. We never invent a result.
 *
 * Pure leaf module (no `@/` alias, no prisma, no fetch) so the verify harness
 * imports it directly under node (mirrors swiss-bucket-core, swiss-standings-core).
 */

import type { Section } from "./layout";
import type { BucketsForSlotCount } from "./swiss-bucket-core";

/** The three pickable Swiss outcome buckets. */
export type SwissPickBucket = "3-0" | "advance" | "0-3";

/** A team's running record, keyed by its layout pickid. */
export interface ClinchInput {
  pickid: number;
  wins: number;
  losses: number;
}

/** A resolved Swiss slot ready to be turned into a StageOutcome row. */
export interface ResolvedSlotRow {
  groupId: number;
  slotIndex: number;
  winnerPickId: number;
}

/**
 * Which PICK bucket a record clinches, or null when it clinches none — either
 * because the team is still playing, or because it is eliminated at 1:3 / 2:3
 * (out of the stage, but that is NOT the 0:3 pick bucket, so no pick scores off
 * it). Parameterized so a non-standard Swiss size stays correct.
 */
export function pickBucketForRecord(
  wins: number,
  losses: number,
  advanceAt = 3,
  eliminateAt = 3,
): SwissPickBucket | null {
  if (wins >= advanceAt) return losses === 0 ? "3-0" : "advance"; // 3:0 vs 3:1 / 3:2
  if (losses >= eliminateAt) return wins === 0 ? "0-3" : null; // 0:3 pick bucket vs plain out
  return null; // still in contention
}

/**
 * Map a bucket LABEL (from swiss-bucket-core) to its pick bucket. Mirrors
 * swiss-standings-core's statusForBucketLabel so the slot→bucket convention has
 * one definition: "0:3" → eliminated bucket, the exact "3:0 ADVANCED" → 3-0,
 * everything else (the 3:1 / 3:2 card, or the single-bucket fallback) → advance.
 */
export function pickBucketForLabel(label: string): SwissPickBucket {
  if (label.includes("0:3")) return "0-3";
  if (label === "3:0 ADVANCED") return "3-0";
  return "advance";
}

/**
 * Does a team's CURRENT record contradict a resolved slot of pick bucket `bucket`
 * (PHA-1109 self-heal)? A StageOutcome slot is normally terminal-and-immutable,
 * but the bridge can persist a WRONG winner when it resolves off a stale/partial
 * crawl (the cache froze mid-stage with a team still reading 0:2, then it lost its
 * third and the frozen row never caught up). Records are monotonic and a terminal
 * record is permanent truth, so a stored winner whose own live record can no
 * longer land in its slot's bucket is provably wrong and must be evicted:
 *
 *   - 0:3 slot   → contradicted once the stored team has ANY win (wins >= 1): it
 *                  can never be the 0-3 it was recorded as.
 *   - 3:0 slot   → contradicted once it has ANY loss (losses >= 1).
 *   - advance    → contradicted once it is eliminated short of advancing
 *                  (losses >= eliminateAt && wins < advanceAt).
 * Plus the general case: the team has a DIFFERENT terminal pick bucket than the
 * slot it sits in (e.g. a 3:1 team parked in a 0:3 slot). Returns false when the
 * record is still compatible (incl. the all-zero / not-yet-contradicting case) so
 * a correct row is never disturbed.
 */
export function recordContradictsBucket(
  bucket: SwissPickBucket,
  wins: number,
  losses: number,
  advanceAt = 3,
  eliminateAt = 3,
): boolean {
  const terminal = pickBucketForRecord(wins, losses, advanceAt, eliminateAt);
  if (terminal !== null && terminal !== bucket) return true;
  switch (bucket) {
    case "3-0":
      return losses >= 1;
    case "0-3":
      return wins >= 1;
    case "advance":
      return losses >= eliminateAt && wins < advanceAt;
  }
}

/**
 * Find resolved slots whose stored winner the current live records CONTRADICT
 * (PHA-1109 self-heal). Returns the StageOutcome rows the bridge should EVICT so
 * the correct clinched team can take the freed slot. Conservative by construction:
 * a slot is only flagged when we have a record for its stored team that provably
 * rules out the slot's bucket (`recordContradictsBucket`). A stored team absent
 * from the current crawl is left untouched — a missing read is not evidence of a
 * wrong result, only a positive contradiction is.
 */
export function findContradictedSlots(
  section: Section,
  standings: readonly ClinchInput[],
  existing: ReadonlyArray<{ groupId: number; slotIndex: number; winnerPickId: number }>,
  bucketsFor: BucketsForSlotCount,
  opts: { advanceAt?: number; eliminateAt?: number } = {},
): Array<{ groupId: number; slotIndex: number; winnerPickId: number }> {
  const recByPick = new Map<number, ClinchInput>();
  for (const r of standings) recByPick.set(r.pickid, r);

  const evict: Array<{ groupId: number; slotIndex: number; winnerPickId: number }> = [];
  for (const group of section.groups) {
    // slotIndex → pick bucket, for this group's layout.
    const bucketBySlot = new Map<number, SwissPickBucket>();
    for (const b of bucketsFor(group.picks.length)) {
      const bucket = pickBucketForLabel(b.label);
      for (const s of b.slotIndexes) bucketBySlot.set(s, bucket);
    }
    for (const e of existing) {
      if (e.groupId !== group.groupid) continue;
      const bucket = bucketBySlot.get(e.slotIndex);
      if (bucket === undefined) continue; // slot not in any known bucket (defensive)
      const rec = recByPick.get(e.winnerPickId);
      if (!rec) continue; // no current record for this team — don't evict on missing data
      if (recordContradictsBucket(bucket, rec.wins, rec.losses, opts.advanceAt, opts.eliminateAt)) {
        evict.push({ groupId: e.groupId, slotIndex: e.slotIndex, winnerPickId: e.winnerPickId });
      }
    }
  }
  return evict;
}

/**
 * Derive the newly-clinched Swiss slots for a section. Reads each team's terminal
 * record, finds the pick bucket it clinched, and assigns it to a free slot of
 * that bucket — skipping teams already placed (idempotent) and buckets with no
 * free slot left (defensive; a real Swiss can't overfill a bucket).
 *
 * `existing` is the section's already-resolved StageOutcome rows, so a clinched
 * slot is never rewritten and an already-placed team is never duplicated.
 */
export function deriveClinchedSlots(
  section: Section,
  standings: readonly ClinchInput[],
  existing: ReadonlyArray<{ groupId: number; slotIndex: number; winnerPickId: number }>,
  bucketsFor: BucketsForSlotCount,
  opts: { advanceAt?: number; eliminateAt?: number } = {},
): ResolvedSlotRow[] {
  const out: ResolvedSlotRow[] = [];

  for (const group of section.groups) {
    // Slots already filled + teams already placed for this group (terminal).
    const filledSlots = new Set<number>();
    const placedTeams = new Set<number>();
    for (const e of existing) {
      if (e.groupId !== group.groupid) continue;
      filledSlots.add(e.slotIndex);
      placedTeams.add(e.winnerPickId);
    }

    // bucket → free slot indexes (layout order), excluding already-filled.
    const freeSlotsByBucket = new Map<SwissPickBucket, number[]>();
    for (const b of bucketsFor(group.picks.length)) {
      const bucket = pickBucketForLabel(b.label);
      const free = b.slotIndexes.filter((s) => !filledSlots.has(s));
      const existingFree = freeSlotsByBucket.get(bucket) ?? [];
      freeSlotsByBucket.set(bucket, [...existingFree, ...free]);
    }

    // Place each newly-clinched team into its bucket's next free slot.
    for (const row of standings) {
      if (row.pickid === 0 || placedTeams.has(row.pickid)) continue;
      const bucket = pickBucketForRecord(row.wins, row.losses, opts.advanceAt, opts.eliminateAt);
      if (!bucket) continue; // not terminal / not a pick bucket
      const free = freeSlotsByBucket.get(bucket);
      if (!free || free.length === 0) continue; // bucket full — drop (defensive)
      const slotIndex = free.shift()!;
      placedTeams.add(row.pickid);
      out.push({ groupId: group.groupid, slotIndex, winnerPickId: row.pickid });
    }
  }

  return out;
}
