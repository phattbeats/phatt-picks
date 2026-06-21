/**
 * Challenge coins (PHA-1278) — server-side assembly of a player's coin shelf.
 *
 * Mirrors the /majors history maths exactly (scorePlayer + the leaderboard's
 * score-desc / name tiebreak) so a Major's coin tier agrees with its leaderboard
 * finish, then hands the per-Major rows to the pure `deriveChallengeCoins`.
 *
 * Read-only: picks/outcomes are already persisted per eventId, so no schema and
 * no crawl. The live (unfinished) Major is short-circuited BEFORE its field is
 * scored — `isEventFrozenById` is false for it — so this adds ZERO database work
 * while an event is in flight; it only does a concluded Major's scoring once,
 * post-archive. The pure tiering/earn logic lives in challenge-coin-core.ts.
 */

import { prisma } from "./db";
import { getCommittedLayout, type Layout } from "./layout";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "./scoring";
import { getEventConfig } from "./events-core";
import { computeFinish } from "./majors-core";
import { coinMintAtMs } from "./event-freeze";
import {
  deriveChallengeCoins,
  type ChallengeCoin,
  type CoinInput,
} from "./challenge-coin-core";

/**
 * Every challenge coin `playerId` has earned, newest Major first. Empty while
 * the only Major a player has touched is still live (coins mint on conclusion).
 * `nowMs` is injectable so a render can share its request clock.
 */
export async function getPlayerChallengeCoins(
  playerId: string,
  nowMs: number = Date.now(),
): Promise<ChallengeCoin[]> {
  // Which Majors has this player played? (distinct events in their picks.)
  const playedRows = await prisma.pick.findMany({
    where: { playerId },
    distinct: ["eventId"],
    select: { eventId: true },
  });

  const committed = getCommittedLayout();
  /** The layout fixture that describes a given event, or null if not loadable. */
  const layoutFor = (eventId: number): Layout | null =>
    committed.event === eventId ? committed : null;

  // Sort newest Major first by start date (registry `dates.start`), slug as a
  // stable tiebreak — same order as buildMajorsHistory, so the shelf reads
  // left-to-right newest→oldest with no separate sort downstream.
  const events = playedRows
    .map((r) => ({ eventId: r.eventId, cfg: getEventConfig(r.eventId) }))
    .filter((e): e is { eventId: number; cfg: NonNullable<typeof e.cfg> } => e.cfg !== null)
    .sort(
      (a, b) =>
        b.cfg.dates.start.localeCompare(a.cfg.dates.start) ||
        a.cfg.slug.localeCompare(b.cfg.slug),
    );

  const inputs: CoinInput[] = [];
  for (const { eventId, cfg } of events) {
    // Coins mint the moment the Grand Final crowns a champion — short-circuit
    // the live/unfinished event before any field scoring (zero added DB work
    // while in flight). The GF-resolved instant doubles as the mint time
    // (earnedAtMs); no 48h archive-grace wait (PHA-1274).
    const archivedAtMs = await coinMintAtMs(eventId, nowMs);
    if (archivedAtMs === null) continue;

    const layout = layoutFor(eventId);

    // The whole field for this event: score everyone, rank, then read off finish.
    const allPicks = await prisma.pick.findMany({
      where: { eventId },
      include: { player: { select: { displayName: true } } },
    });
    const outcomes = await prisma.stageOutcome.findMany({ where: { eventId } });

    const outcomeMap: OutcomeMap = {};
    for (const o of outcomes) {
      outcomeMap[o.sectionId] ??= {};
      outcomeMap[o.sectionId][o.groupId] ??= {};
      outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    }

    const pickMap: PlayerPickMap = {};
    const nameById: Record<string, string> = {};
    let myPickCount = 0;
    for (const p of allPicks) {
      pickMap[p.playerId] ??= {};
      pickMap[p.playerId][p.sectionId] ??= {};
      pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
      pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
      nameById[p.playerId] = p.player.displayName;
      if (p.playerId === playerId && p.pickId !== 0) myPickCount++;
    }

    const playerIds = Object.keys(pickMap);
    const scoreById: Record<string, number> = {};
    for (const pid of playerIds) {
      scoreById[pid] = layout ? scorePlayer(layout, pickMap[pid], outcomeMap).total : 0;
    }
    // Same ordering as the leaderboard: score desc, then displayName asc.
    const ranked = [...playerIds].sort(
      (a, b) => scoreById[b] - scoreById[a] || (nameById[a] ?? "").localeCompare(nameById[b] ?? ""),
    );

    inputs.push({
      eventId,
      slug: cfg.slug,
      name: cfg.name,
      archived: true,
      participated: myPickCount > 0,
      scored: layout != null,
      finish: layout ? computeFinish(playerId, ranked) : null,
      fieldSize: playerIds.length,
      earnedAtMs: archivedAtMs,
    });
  }

  return deriveChallengeCoins(inputs);
}
