/**
 * Leaderboard API — scores all players for the active event against resolved outcomes.
 *
 * Returns all players (local + synced) on one board.
 * Coin visibility gated server-side: only sends coinTier when synced && hasViewerPass && hasValveCoin.
 * Picks hidden until stage lock (stage lock determined by picks_allowed in layout).
 *
 * `?major=<slug>` returns that registered event's FINAL standings instead
 * (its own Pick + StageOutcome rows, entrants only, same scoring + coin gate).
 * An unknown slug, or the current event's slug, falls back to the live board.
 * If this build can't load the requested event's layout, the response is an
 * honest empty board with `scored: false`.
 */

import { NextResponse } from "next/server";
import { getCommittedLayout } from "@/lib/layout";
import { getSession } from "@/lib/session";
import { currentEventId } from "@/lib/events-core";
import { buildLeaderboard, layoutForEvent, resolveArchiveEvent } from "@/lib/leaderboard";

export async function GET(request: Request) {
  const session = await getSession();
  const slug = new URL(request.url).searchParams.get("major");
  const archive = resolveArchiveEvent(slug);

  if (archive) {
    const layout = layoutForEvent(archive.eventId);
    if (!layout) {
      return NextResponse.json({
        leaderboard: [],
        eventId: archive.eventId,
        major: archive.slug,
        final: true,
        scored: false,
      });
    }
    const { rows } = await buildLeaderboard({
      eventId: archive.eventId,
      layout,
      sessionPlayerId: session?.playerId,
      entrantsOnly: true,
    });
    return NextResponse.json({
      leaderboard: rows,
      eventId: archive.eventId,
      major: archive.slug,
      final: true,
      scored: true,
    });
  }

  const EVENT_ID = currentEventId(); // per-request active event (#1046)
  const { rows } = await buildLeaderboard({
    eventId: EVENT_ID,
    layout: getCommittedLayout(),
    sessionPlayerId: session?.playerId,
  });
  return NextResponse.json({ leaderboard: rows, eventId: EVENT_ID });
}
