/**
 * Fantasy ingest poke + status (PHA-5454).
 *
 * GET runs one ingest tick for the current Major and reports what is stored.
 * Unauthenticated and safe for the same reasons as /api/standings/refresh: it
 * takes no input that reaches a URL (it only reads the committed HLTV event
 * pages of the stages being played), it only writes our own match cache, and
 * it is bounded by the tick's floor, so repeated calls cannot hammer HLTV.
 *
 * Owner only (or outside production): `?force=1` skips the floor, and
 * `?event=<valve id>&hltvEvent=<hltv id>` reads one whole HLTV event into that
 * Major, which is how a finished stage is replayed as a test or backfilled.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";
import { currentEventId, getEventConfig } from "@/lib/events-core";
import { ingestFantasyTick, ingestHltvEvent, loadFantasyContext } from "@/lib/fantasy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const privileged = process.env.NODE_ENV !== "production" || isOwner(await getSession());

  const hltvEvent = Number(params.get("hltvEvent"));
  const eventParam = Number(params.get("event"));
  if (privileged && Number.isInteger(hltvEvent) && hltvEvent > 0) {
    const eventId = Number.isInteger(eventParam) && getEventConfig(eventParam) ? eventParam : currentEventId();
    const log: string[] = [];
    const r = await ingestHltvEvent({ eventId, hltvEventId: hltvEvent, onProgress: (l) => log.push(l) });
    return NextResponse.json({ eventId, hltvEvent, ...r, log });
  }

  const eventId = currentEventId();
  const tick = await ingestFantasyTick(eventId, Date.now(), { force: privileged && params.get("force") === "1" });
  const ctx = await loadFantasyContext(eventId);
  return NextResponse.json({
    tick,
    stages: (ctx?.stages ?? []).map((v) => ({
      id: v.stage.id,
      name: v.stage.short,
      phase: v.phase,
      startsAt: v.startMs ? new Date(v.startMs).toISOString() : null,
      pool: v.pool.length,
      matches: v.matches.length,
    })),
  });
}
