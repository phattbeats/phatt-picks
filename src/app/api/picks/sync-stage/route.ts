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
import { ACTIVE_EVENT_ID } from "@/lib/events-core";

const EVENT_ID = ACTIVE_EVENT_ID;
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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

  return NextResponse.json(result);
}
