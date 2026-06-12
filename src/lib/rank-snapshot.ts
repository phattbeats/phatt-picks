/**
 * Rank-snapshot persistence (server-only) — wraps the pure core with Prisma.
 *
 * Called from the outcomes ingest path after StageOutcome rows land, so a
 * snapshot is frozen at every stage resolution (PHA-858). Idempotent: re-running
 * recomputes the same cumulative standings and upserts in place, which also
 * self-heals snapshots if an outcome is corrected/backfilled later.
 *
 * Read helpers (rankMapForSection / snapshotSectionIds) back the leaderboard
 * delta arrows and the Stage Reveal screen.
 */

import { prisma } from "./db";
import { getCommittedLayout } from "./layout";
import { type PlayerPickMap, type OutcomeMap } from "./scoring";
import { buildSnapshotRows } from "./rank-snapshot-core";

/** Build the standard (PlayerPickMap, OutcomeMap) inputs for an event. */
async function loadScoringInputs(eventId: number): Promise<{
  players: { id: string; displayName: string }[];
  pickMap: PlayerPickMap;
  outcomeMap: OutcomeMap;
  resolvedSectionIds: number[];
}> {
  const [players, picks, outcomes] = await Promise.all([
    prisma.player.findMany({ select: { id: true, displayName: true } }),
    prisma.pick.findMany({
      where: { eventId },
      select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({ where: { eventId } }),
  ]);

  const pickMap: PlayerPickMap = {};
  for (const p of picks) {
    pickMap[p.playerId] ??= {};
    pickMap[p.playerId][p.sectionId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  const outcomeMap: OutcomeMap = {};
  const resolved = new Set<number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    resolved.add(o.sectionId);
  }

  return { players, pickMap, outcomeMap, resolvedSectionIds: [...resolved] };
}

/**
 * Recompute and upsert rank snapshots for every resolved section of an event.
 * Safe to call on every ingest; a no-op when nothing has resolved yet.
 */
export async function writeRankSnapshots(
  eventId: number,
  now: Date = new Date(),
): Promise<{ written: number }> {
  const layout = getCommittedLayout();
  const { players, pickMap, outcomeMap, resolvedSectionIds } = await loadScoringInputs(eventId);
  if (resolvedSectionIds.length === 0) return { written: 0 };

  const rows = buildSnapshotRows(layout, resolvedSectionIds, players, pickMap, outcomeMap);
  if (rows.length === 0) return { written: 0 };

  await prisma.$transaction(
    rows.map((row) =>
      prisma.rankSnapshot.upsert({
        where: {
          playerId_eventId_sectionId: {
            playerId: row.playerId,
            eventId,
            sectionId: row.sectionId,
          },
        },
        update: { rank: row.rank, score: row.score, resolvedAt: now },
        create: {
          playerId: row.playerId,
          eventId,
          sectionId: row.sectionId,
          rank: row.rank,
          score: row.score,
          resolvedAt: now,
        },
      }),
    ),
  );
  return { written: rows.length };
}

/**
 * playerId -> rank from the snapshot frozen at `sectionId` (empty if none).
 * Defensive: if the RankSnapshot table doesn't exist yet (deploy before
 * `prisma db push`) or any read fails, degrade to an empty map so the
 * leaderboard/reveal just drop the arrows instead of 500ing.
 */
export async function rankMapForSection(
  eventId: number,
  sectionId: number | null,
): Promise<Map<string, number>> {
  if (sectionId == null) return new Map();
  try {
    const rows = await prisma.rankSnapshot.findMany({
      where: { eventId, sectionId },
      select: { playerId: true, rank: true },
    });
    return new Map(rows.map((r) => [r.playerId, r.rank]));
  } catch (e) {
    console.error("[rank-snapshot] rankMapForSection read failed (degrading):", e);
    return new Map();
  }
}

/** Distinct sections that have a snapshot for this event, ascending. Degrades to []. */
export async function snapshotSectionIds(eventId: number): Promise<number[]> {
  try {
    const rows = await prisma.rankSnapshot.findMany({
      where: { eventId },
      distinct: ["sectionId"],
      select: { sectionId: true },
      orderBy: { sectionId: "asc" },
    });
    return rows.map((r) => r.sectionId);
  } catch (e) {
    console.error("[rank-snapshot] snapshotSectionIds read failed (degrading):", e);
    return [];
  }
}
