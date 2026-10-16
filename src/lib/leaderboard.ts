/**
 * Shared leaderboard builder — one scoring path for the live board, the
 * event-scoped archive board (`/leaderboard?major=<slug>`) and the
 * `/api/leaderboard` route, so all three agree to the point.
 *
 * Read-only: it never writes, never refreshes outcomes (callers that serve the
 * live event trigger `refreshOutcomesOnRead` themselves). Scoring maths,
 * tiebreak (score desc, then display name) and the Valve coin gate
 * (`visibleCoinTier`) are exactly the ones the live board has always used.
 */

import { prisma } from "@/lib/db";
import { committedLayoutFor, type Layout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap, type ScoreBreakdown } from "@/lib/scoring";
import { visibleCoinTier } from "@/lib/coin-core";
import { currentEventId, getEventBySlug, type EventConfig } from "@/lib/events-core";

export interface LeaderboardRow {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  isLocal: boolean;
  synced: boolean;
  /** Coin gate (rule #4) — null unless synced && hasViewerPass && hasValveCoin. */
  coinTier: string | null;
  score: number;
  bySection: ScoreBreakdown["bySection"];
  isSelf: boolean;
}

export interface Leaderboard {
  rows: LeaderboardRow[];
  latestResolvedAt: Date | null;
}

/** "IEM Cologne 2026 CS2 Major Championship" → "IEM Cologne 2026". */
export function eventShortName(event: Pick<EventConfig, "name">): string {
  return event.name.replace(/\s+CS2\s+Major\s+Championship$/i, "").trim();
}

/**
 * The layout fixture that describes `eventId`, or null when this build can't
 * load it. Only the committed fixture is loadable today (it's Cologne's), so any
 * other event degrades honestly — same rule as the Majors page (`layoutFor`).
 */
export function layoutForEvent(eventId: number): Layout | null {
  return committedLayoutFor(eventId);
}

/**
 * Resolve `?major=<slug>` to a registered event that is NOT the one currently
 * being served. Returns null for a missing/unknown slug or the current event —
 * callers then fall back to the live board.
 */
export function resolveArchiveEvent(slug: string | undefined | null, nowMs: number = Date.now()): EventConfig | null {
  if (!slug) return null;
  const event = getEventBySlug(slug);
  if (!event || event.eventId === currentEventId(nowMs)) return null;
  return event;
}

/**
 * Score every player for `eventId` against its own Pick + StageOutcome rows.
 *
 * `entrantsOnly` limits the board to players with at least one pick in the
 * event (used by the archive view, where players who joined later never
 * played). The live board keeps listing every registered player, as before.
 */
export async function buildLeaderboard({
  eventId,
  layout,
  sessionPlayerId,
  entrantsOnly = false,
}: {
  eventId: number;
  layout: Layout;
  sessionPlayerId: string | null | undefined;
  entrantsOnly?: boolean;
}): Promise<Leaderboard> {
  const [allPicks, outcomes] = await Promise.all([
    prisma.pick.findMany({ where: { eventId }, include: { player: true } }),
    prisma.stageOutcome.findMany({ where: { eventId } }),
  ]);

  const latestResolvedAt = outcomes.reduce<Date | null>(
    (max, o) => (max === null || o.resolvedAt > max ? o.resolvedAt : max),
    null,
  );

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  type Meta = {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    isLocal: boolean;
    synced: boolean;
    hasViewerPass: boolean;
    hasValveCoin: boolean;
    coinTier: string | null;
  };
  const toMeta = (p: Meta): Meta => ({
    id: p.id,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    isLocal: p.isLocal,
    synced: p.synced,
    hasViewerPass: p.hasViewerPass,
    hasValveCoin: p.hasValveCoin,
    coinTier: p.coinTier,
  });

  const playerPickMap: PlayerPickMap = {};
  const playerMeta: Record<string, Meta> = {};
  for (const pick of allPicks) {
    const pid = pick.playerId;
    playerPickMap[pid] ??= {};
    playerPickMap[pid][pick.sectionId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId][pick.slotIndex] = pick.pickId;
    playerMeta[pid] ??= toMeta(pick.player);
  }

  if (!entrantsOnly) {
    // Live board: also list players with no picks yet.
    const allPlayers = await prisma.player.findMany();
    for (const p of allPlayers) playerMeta[p.id] ??= toMeta(p);
  }

  const rows: LeaderboardRow[] = Object.entries(playerMeta)
    .map(([pid, meta]) => {
      const score = scorePlayer(layout, playerPickMap[pid] ?? {}, outcomeMap);
      return {
        playerId: pid,
        displayName: meta.displayName,
        avatarUrl: meta.avatarUrl,
        isLocal: meta.isLocal,
        synced: meta.synced,
        coinTier: visibleCoinTier(meta),
        score: score.total,
        bySection: score.bySection,
        isSelf: !!sessionPlayerId && sessionPlayerId === pid,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  return { rows, latestResolvedAt };
}
