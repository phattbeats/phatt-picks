/**
 * Rank-snapshot logic (PHA-858) — pure.
 *
 * A RankSnapshot freezes the cumulative standings at a stage resolution so we
 * can answer two things the live tables can't:
 *   1. Leaderboard rank-delta arrows (mockup-04) — how each player moved across
 *      the most recently resolved stage.
 *   2. Stage Reveal screen (mockup-08) — a player's rank before vs. after a
 *      stage, plus how their picks landed.
 *
 * "Cumulative" mirrors the leaderboard exactly: standings at section N reflect
 * every resolved outcome through section N, ranked by total points (desc) with
 * displayName as the tiebreak — the SAME ordering as /leaderboard. We only ever
 * snapshot sections that already have resolved outcomes, so a snapshot never
 * disagrees with what users see.
 *
 * Imports `scorePlayer` (which only type-imports the layout — no fixture, no
 * prisma) so this module stays loadable by the offline verify harness.
 */

import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "./scoring";
import type { Layout } from "./layout";

export interface RankEntry {
  playerId: string;
  displayName: string;
  rank: number;
  score: number; // total points over the supplied outcomes
}

export interface PlayerRef {
  id: string;
  displayName: string;
}

/** Restrict an outcome map to sections with id <= maxSectionId (inclusive). */
export function restrictOutcomes(outcomes: OutcomeMap, maxSectionId: number): OutcomeMap {
  const out: OutcomeMap = {};
  for (const key of Object.keys(outcomes)) {
    const sec = Number(key);
    if (sec <= maxSectionId) out[sec] = outcomes[sec];
  }
  return out;
}

/**
 * Rank the whole field over a given outcome set. Ordering is identical to the
 * leaderboard: points desc, then displayName asc. Ranks are 1-based by position
 * (ties broken deterministically by name, matching the board).
 */
export function rankStandings(
  layout: Layout,
  players: PlayerRef[],
  pickMap: PlayerPickMap,
  outcomes: OutcomeMap,
): RankEntry[] {
  const scored = players.map((p) => ({
    playerId: p.id,
    displayName: p.displayName,
    score: scorePlayer(layout, pickMap[p.id] ?? {}, outcomes).total,
  }));
  scored.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

export interface SnapshotRow {
  playerId: string;
  sectionId: number;
  rank: number;
  score: number;
}

/**
 * Build snapshot rows for every resolved section: for each section (ascending),
 * rank the field over the cumulative outcomes through that section and emit one
 * row per player. `resolvedSectionIds` is the set of sections that have at least
 * one resolved outcome — the caller derives it from StageOutcome rows.
 */
export function buildSnapshotRows(
  layout: Layout,
  resolvedSectionIds: number[],
  players: PlayerRef[],
  pickMap: PlayerPickMap,
  outcomes: OutcomeMap,
): SnapshotRow[] {
  const ordered = [...new Set(resolvedSectionIds)].sort((a, b) => a - b);
  const rows: SnapshotRow[] = [];
  for (const sec of ordered) {
    const ranked = rankStandings(layout, players, pickMap, restrictOutcomes(outcomes, sec));
    for (const r of ranked) {
      rows.push({ playerId: r.playerId, sectionId: sec, rank: r.rank, score: r.score });
    }
  }
  return rows;
}

export type Direction = "up" | "down" | "flat" | "new";

export interface RankDelta {
  /** baselineRank - currentRank; positive = climbed. null when no baseline. */
  delta: number | null;
  direction: Direction;
}

/**
 * Diff a current rank against a baseline rank. A player with no baseline (joined
 * or first scored since) is "new" — we never fabricate movement for them.
 */
export function rankDelta(currentRank: number, baselineRank: number | null | undefined): RankDelta {
  if (baselineRank == null) return { delta: null, direction: "new" };
  const delta = baselineRank - currentRank; // smaller rank number = better = positive
  return { delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

/** Most recent resolved section, or null. */
export function latestSectionId(resolvedSectionIds: number[]): number | null {
  const o = [...new Set(resolvedSectionIds)].sort((a, b) => a - b);
  return o.length ? o[o.length - 1] : null;
}

/**
 * Baseline section for leaderboard deltas: the resolved section immediately
 * before the latest one. Returns null when fewer than two sections have
 * resolved (nothing has moved yet → no arrows).
 */
export function baselineSectionId(resolvedSectionIds: number[]): number | null {
  const o = [...new Set(resolvedSectionIds)].sort((a, b) => a - b);
  return o.length >= 2 ? o[o.length - 2] : null;
}

/** The resolved section immediately before `sectionId`, or null. */
export function previousResolvedSection(
  resolvedSectionIds: number[],
  sectionId: number,
): number | null {
  const earlier = [...new Set(resolvedSectionIds)].filter((s) => s < sectionId).sort((a, b) => a - b);
  return earlier.length ? earlier[earlier.length - 1] : null;
}
