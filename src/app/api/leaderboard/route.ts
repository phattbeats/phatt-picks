/**
 * Leaderboard API — scores all players for event 26 against resolved outcomes.
 *
 * Returns all players (local + synced) on one board.
 * Coin visibility gated server-side: only sends coinTier when synced && hasViewerPass && hasValveCoin.
 * Picks hidden until stage lock (stage lock determined by picks_allowed in layout).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCommittedLayout } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { visibleCoinTier } from "@/lib/coin-core";
import { getSession } from "@/lib/session";

const EVENT_ID = 26;

export async function GET() {
  const session = await getSession();
  const layout = getCommittedLayout();

  // Load all picks for this event
  const allPicks = await prisma.pick.findMany({
    where: { eventId: EVENT_ID },
    include: { player: true },
  });

  // Load outcomes
  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId: EVENT_ID },
  });

  // Build outcome map
  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  // Build per-player pick map
  const playerPickMap: PlayerPickMap = {};
  const playerMeta: Record<string, { id: string; displayName: string; avatarUrl: string | null; isLocal: boolean; synced: boolean; hasViewerPass: boolean; hasValveCoin: boolean; coinTier: string | null }> = {};

  for (const pick of allPicks) {
    const pid = pick.playerId;
    playerPickMap[pid] ??= {};
    playerPickMap[pid][pick.sectionId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId] ??= {};
    playerPickMap[pid][pick.sectionId][pick.groupId][pick.slotIndex] = pick.pickId;

    if (!playerMeta[pid]) {
      const p = pick.player;
      playerMeta[pid] = {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isLocal: p.isLocal,
        synced: p.synced,
        hasViewerPass: p.hasViewerPass,
        hasValveCoin: p.hasValveCoin,
        coinTier: p.coinTier,
      };
    }
  }

  // Also include players with no picks yet
  const allPlayers = await prisma.player.findMany();
  for (const p of allPlayers) {
    if (!playerMeta[p.id]) {
      playerMeta[p.id] = {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isLocal: p.isLocal,
        synced: p.synced,
        hasViewerPass: p.hasViewerPass,
        hasValveCoin: p.hasValveCoin,
        coinTier: p.coinTier,
      };
    }
  }

  // Score each player
  const rows = Object.entries(playerMeta).map(([pid, meta]) => {
    const picks = playerPickMap[pid] ?? {};
    const score = scorePlayer(layout, picks, outcomeMap);

    return {
      playerId: pid,
      displayName: meta.displayName,
      avatarUrl: meta.avatarUrl,
      isLocal: meta.isLocal,
      synced: meta.synced,
      // Coin gate (rule #4) — null unless synced && hasViewerPass && hasValveCoin.
      coinTier: visibleCoinTier(meta),
      score: score.total,
      bySection: score.bySection,
      isSelf: session?.playerId === pid,
    };
  });

  rows.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  return NextResponse.json({ leaderboard: rows, eventId: EVENT_ID });
}
