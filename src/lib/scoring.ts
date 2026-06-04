/**
 * Scoring engine — reads weights from layout, never hardcodes them.
 *
 * Rules (from spec):
 * - Within a Swiss stage, every correct pick earns the stage's flat points_per_pick.
 *   3-0 / 0-3 / advance does NOT change points within a stage.
 * - Each playoff match is one pick worth that group's points_per_pick.
 * - Perfect tournament = 135 pts (60 Swiss + 75 Playoffs) — for verification only.
 *
 * BUCKET-AWARE SWISS (PHA-918): a Swiss stage's slots are grouped into buckets
 * (3:0 / advance / 0:3) and the slots WITHIN a bucket are interchangeable — if
 * you tag BetBoom and B8 as your two 3:0 teams it doesn't matter which slot each
 * sits in. So Swiss scoring compares the player's picks against the resolved
 * winners as SETS per bucket, not slot-for-slot. Playoff matches stay strict per
 * slot (one match = one answer). This keeps the flat-value-per-stage rule intact
 * (every correct bucket pick is worth the stage weight) while scoring the
 * set-valued buckets the way Valve's Pick'Em actually resolves them.
 */

import type { Layout } from "./layout";
import { bucketSwissSlots, isSwissSection } from "./swiss-bucket-core";

export interface PlayerPickMap {
  // playerId → sectionId → groupId → slotIndex → pickId
  [playerId: string]: {
    [sectionId: number]: {
      [groupId: number]: {
        [slotIndex: number]: number;
      };
    };
  };
}

export interface OutcomeMap {
  // eventId → sectionId → groupId → slotIndex → winnerPickId
  [sectionId: number]: {
    [groupId: number]: {
      [slotIndex: number]: number;
    };
  };
}

export interface ScoreBreakdown {
  total: number;
  bySection: { sectionId: number; points: number; correct: number; possible: number }[];
}

/**
 * Score a single player's picks against resolved outcomes.
 * Only slots present in `outcomes` are scored (unresolved = no points yet).
 */
export function scorePlayer(
  layout: Layout,
  playerPicks: PlayerPickMap[string],
  outcomes: OutcomeMap
): ScoreBreakdown {
  const bySection: ScoreBreakdown["bySection"] = [];
  let total = 0;

  for (const section of layout.sections) {
    let sectionPts = 0;
    let correct = 0;
    let possible = 0;

    const swiss = isSwissSection(section.sectionid);

    for (const group of section.groups) {
      const ptsPerPick = group.points_per_pick;
      const groupPicks = playerPicks?.[section.sectionid]?.[group.groupid] ?? {};
      const groupOutcomes = outcomes?.[section.sectionid]?.[group.groupid] ?? {};

      if (swiss) {
        // Bucket-aware: within each bucket, count how many of the resolved teams
        // the player also tagged for that bucket (set intersection). `possible`
        // is the points on the table so far — the resolved-team count × weight —
        // so it stays ≤ the bucket's slot count and points never exceed possible.
        for (const bucket of bucketSwissSlots(group.picks.length)) {
          const resolved = new Set<number>();
          const picked = new Set<number>();
          for (const slotIndex of bucket.slotIndexes) {
            const w = groupOutcomes[slotIndex];
            if (w !== undefined && w !== 0) resolved.add(w);
            const p = groupPicks[slotIndex];
            if (p !== undefined && p !== 0) picked.add(p);
          }
          for (const team of resolved) {
            possible += ptsPerPick;
            if (picked.has(team)) {
              sectionPts += ptsPerPick;
              correct++;
            }
          }
        }
        continue;
      }

      // Playoffs (and any non-Swiss group): strict per-slot match.
      for (const slot of group.picks) {
        const outWinner = groupOutcomes[slot.index];
        if (outWinner === undefined) continue; // not yet resolved

        possible += ptsPerPick;
        const playerChoice = groupPicks[slot.index];
        if (playerChoice !== undefined && playerChoice === outWinner && playerChoice !== 0) {
          sectionPts += ptsPerPick;
          correct++;
        }
      }
    }

    bySection.push({ sectionId: section.sectionid, points: sectionPts, correct, possible });
    total += sectionPts;
  }

  return { total, bySection };
}

/** Maximum possible score across all sections (all picks correct). */
export function maxPossibleScore(layout: Layout): number {
  let max = 0;
  for (const section of layout.sections) {
    for (const group of section.groups) {
      max += group.picks.length * group.points_per_pick;
    }
  }
  return max;
}
