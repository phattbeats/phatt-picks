/**
 * POST /api/picks/sync-stage — push the session player's locally-stored picks
 * for one stage up to Valve, stage-batched (handoff §8). Session-gated; the
 * Steam API key and per-user auth code stay server-side.
 *
 * Body: { sectionId: number }  → sync that Swiss stage's batch
 *       { playoff: true }      → sync the whole playoff bracket (QF→SF→GF)
 *
 * Always responds 200 with a structured WriteResult so the client can surface
 * state ("synced" / "saved locally") without treating a Valve outage as a hard
 * failure (rules #7/#8). The leaderboard already computes off stored picks, so a
 * degraded write changes nothing user-facing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { syncStageToValve, syncPlayoffBracketToValve } from "@/lib/picks-write";
import { currentEventId } from "@/lib/events-core";
import { isPickemOpen, PICKEM_NOT_OPEN_ERROR } from "@/lib/layout-state";
import { prisma } from "@/lib/db";
import { PLAYOFF_SEAL_UNIT, sealUnitFor } from "@/lib/pick-lock-core";

export async function POST(req: NextRequest) {
  const EVENT_ID = currentEventId(); // per-request active event (#1046)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Pre-open: Valve's write path 404s until its Pick'Em opens. Refuse up front
  // with a clear reason instead of a degraded "saved locally".
  if (!(await isPickemOpen(EVENT_ID))) {
    return NextResponse.json(PICKEM_NOT_OPEN_ERROR, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));

  const result = body?.playoff
    ? await syncPlayoffBracketToValve(session.playerId, EVENT_ID)
    : typeof body?.sectionId === "number"
      ? await syncStageToValve(session.playerId, EVENT_ID, body.sectionId)
      : null;

  if (!result) {
    return NextResponse.json(
      { error: "Provide { sectionId } or { playoff: true }" },
      { status: 400 },
    );
  }

  // A sealed stage whose sealed set just landed on Steam in full now has a
  // known-good Steam baseline: a later in-game change gets flagged by the mirror
  // (pick-lock-core nextSteamState), and any earlier divergence is resolved.
  if (result.ok && !result.degraded && !result.escalate) {
    const unit = sealUnitFor(body?.playoff ? PLAYOFF_SEAL_UNIT : body.sectionId);
    await prisma.pickLock.updateMany({
      where: { playerId: session.playerId, eventId: EVENT_ID, sectionId: unit },
      data: { steamMatchedAt: new Date(), steamDivergedAt: null },
    });
  }

  return NextResponse.json(result);
}
