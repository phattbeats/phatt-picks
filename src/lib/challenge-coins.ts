/**
 * Challenge coins (#1278) — server-side assembly of a player's coin case and
 * of the coin-holders roll (/coins).
 *
 * Mirrors the /majors history maths exactly (scorePlayer + the leaderboard's
 * score-desc / name tiebreak) so a Major's coin tier agrees with its leaderboard
 * finish, then hands the per-Major rows to the pure `deriveChallengeCoins`.
 *
 * Read-only: picks/outcomes are already persisted per eventId, so no schema and
 * no crawl. The live (unfinished) Major is short-circuited BEFORE its field is
 * scored — `coinMintAtMs` returns null for it — so this adds ZERO database work
 * while an event is in flight; it only does a concluded Major's scoring once,
 * its Grand Final has resolved. The pure tiering/earn logic lives in
 * challenge-coin-core.ts.
 */

import { prisma } from "./db";
import { getCommittedLayout, type Layout } from "./layout";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "./scoring";
import { EVENTS, getEventConfig, type EventConfig } from "./events-core";
import { computeFinish } from "./majors-core";
import { coinMintAtMs } from "./event-freeze";
import {
  deriveChallengeCoins,
  type ChallengeCoin,
  type CoinInput,
} from "./challenge-coin-core";

/** One Major's field, scored and ranked exactly like its leaderboard. */
interface ScoredField {
  scored: boolean;
  /** Player ids best-first (score desc, then displayName asc). */
  ranked: string[];
  /** Non-cleared pick count per player. */
  pickCountById: Record<string, number>;
  /** Display name per player (engraved on their coin). */
  nameById: Record<string, string>;
}

/** The layout fixture that describes a given event, or null if not loadable. */
function layoutFor(eventId: number): Layout | null {
  const committed = getCommittedLayout();
  return committed.event === eventId ? committed : null;
}

/** Score + rank one Major's whole field — two queries, no per-player reads. */
async function scoreField(eventId: number): Promise<ScoredField> {
  const layout = layoutFor(eventId);
  const [allPicks, outcomes] = await Promise.all([
    prisma.pick.findMany({
      where: { eventId },
      include: { player: { select: { displayName: true } } },
    }),
    prisma.stageOutcome.findMany({ where: { eventId } }),
  ]);

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const pickMap: PlayerPickMap = {};
  const nameById: Record<string, string> = {};
  const pickCountById: Record<string, number> = {};
  for (const p of allPicks) {
    pickMap[p.playerId] ??= {};
    pickMap[p.playerId][p.sectionId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId] ??= {};
    pickMap[p.playerId][p.sectionId][p.groupId][p.slotIndex] = p.pickId;
    nameById[p.playerId] = p.player.displayName;
    pickCountById[p.playerId] ??= 0;
    if (p.pickId !== 0) pickCountById[p.playerId]++;
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
  return { scored: layout != null, ranked, pickCountById, nameById };
}

/** Newest Major first by start date (registry `dates.start`), slug as a tiebreak. */
function newestFirst(a: EventConfig, b: EventConfig): number {
  return b.dates.start.localeCompare(a.dates.start) || a.slug.localeCompare(b.slug);
}

/** The coin input for the player at `rankIndex` (0-based) in a scored field. */
function coinInputAt(
  cfg: EventConfig,
  field: ScoredField,
  playerId: string,
  mintedAtMs: number,
): CoinInput {
  return {
    eventId: cfg.eventId,
    slug: cfg.slug,
    name: cfg.name,
    archived: true,
    participated: (field.pickCountById[playerId] ?? 0) > 0,
    scored: field.scored,
    finish: field.scored ? computeFinish(playerId, field.ranked) : null,
    fieldSize: field.ranked.length,
    earnedAtMs: mintedAtMs,
    holder: field.nameById[playerId] ?? null,
  };
}

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

  // Newest Major first — same order as buildMajorsHistory, so the case reads
  // left-to-right newest→oldest with no separate sort downstream.
  const events = playedRows
    .map((r) => getEventConfig(r.eventId))
    .filter((cfg): cfg is EventConfig => cfg !== null)
    .sort(newestFirst);

  const inputs: CoinInput[] = [];
  for (const cfg of events) {
    // Coins mint the moment the Grand Final crowns a champion — short-circuit
    // the live/unfinished event before any field scoring (zero added DB work
    // while in flight). The GF-resolved instant doubles as the mint time
    // (earnedAtMs); no 48h archive-grace wait (#1274).
    const mintedAtMs = await coinMintAtMs(cfg.eventId, nowMs);
    if (mintedAtMs === null) continue;
    const field = await scoreField(cfg.eventId);
    inputs.push(coinInputAt(cfg, field, playerId, mintedAtMs));
  }

  return deriveChallengeCoins(inputs);
}

/** One holder of a struck coin, ready for the /coins roll. */
export interface CoinHolder {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  coin: ChallengeCoin;
}

/** One Major's coin roll: who holds which coin, best finish first. */
export interface MajorCoinRoll {
  eventId: number;
  slug: string;
  name: string;
  /** Registry start date (ISO) — for the "Jun 2026" eyebrow. */
  start: string;
  /** When the coins were struck (Grand Final resolved), or null while still to mint. */
  mintedAtMs: number | null;
  fieldSize: number;
  /** Every holder, best finish first (so grouping by tier keeps rank order). */
  holders: CoinHolder[];
}

/**
 * Every registered Major's coin roll, newest first — the coin-holders page.
 * Same earn rule + tiering as each profile's case. A Major still to conclude
 * comes back with `mintedAtMs: null` and no holders, short-circuited before any
 * scoring. Cost: two queries per CONCLUDED Major plus one player lookup total.
 */
export async function getCoinHolders(nowMs: number = Date.now()): Promise<MajorCoinRoll[]> {
  const rolls: MajorCoinRoll[] = [];
  const struck: { roll: MajorCoinRoll; coins: { playerId: string; coin: ChallengeCoin }[] }[] = [];

  for (const cfg of Object.values(EVENTS).sort(newestFirst)) {
    const roll: MajorCoinRoll = {
      eventId: cfg.eventId,
      slug: cfg.slug,
      name: cfg.name,
      start: cfg.dates.start,
      mintedAtMs: null,
      fieldSize: 0,
      holders: [],
    };
    rolls.push(roll);
    const mintedAtMs = await coinMintAtMs(cfg.eventId, nowMs);
    if (mintedAtMs === null) continue;
    roll.mintedAtMs = mintedAtMs;
    const field = await scoreField(cfg.eventId);
    roll.fieldSize = field.ranked.length;
    const coins = field.ranked.flatMap((playerId) =>
      deriveChallengeCoins([coinInputAt(cfg, field, playerId, mintedAtMs)]).map((coin) => ({ playerId, coin })),
    );
    struck.push({ roll, coins });
  }

  const ids = [...new Set(struck.flatMap((e) => e.coins.map((c) => c.playerId)))];
  const players = ids.length
    ? await prisma.player.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, avatarUrl: true },
      })
    : [];
  const byId = new Map(players.map((p) => [p.id, p] as const));
  for (const { roll, coins } of struck) {
    for (const { playerId, coin } of coins) {
      const p = byId.get(playerId);
      if (p) roll.holders.push({ playerId, displayName: p.displayName, avatarUrl: p.avatarUrl, coin });
    }
  }
  return rolls;
}
