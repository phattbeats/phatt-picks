/**
 * Scoring engine — reads weights from layout, never hardcodes them.
 *
 * Rules (from spec):
 * - Within a Swiss stage, every correct pick earns the stage's flat points_per_pick.
 *   3-0 / 0-3 / advance does NOT change points within a stage.
 * - Each playoff match is one pick worth that group's points_per_pick.
 * - Perfect tournament = 135 pts (60 Swiss + 75 Playoffs) — for verification only.
 */

import type { Layout, Group } from "./layout";

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

    for (const group of section.groups) {
      const ptsPerPick = group.points_per_pick;
      const groupPicks = playerPicks?.[section.sectionid]?.[group.groupid] ?? {};
      const groupOutcomes = outcomes?.[section.sectionid]?.[group.groupid] ?? {};

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
