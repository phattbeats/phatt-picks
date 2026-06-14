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
