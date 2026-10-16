/**
 * POST /api/picks/sync — read the session player's live Valve predictions and
 * mirror them into the local Pick table. Session-gated; the Steam API key and
 * the per-user auth code stay server-side.
 *
 * Always 200 with a structured body describing what happened (mirrored count,
 * or skipped/error reason) so the client can surface state without treating a
 * Valve outage as a hard failure (rules #7/#8).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { mirrorPlayerPredictions } from "@/lib/predictions-sync";
import { currentEventId } from "@/lib/events-core";
import { isPickemOpen, PICKEM_NOT_OPEN_ERROR } from "@/lib/layout-state";

export async function POST() {
  const EVENT_ID = currentEventId(); // per-request active event (#1046)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Pre-open: there are no Valve predictions to read until Pick'Em opens.
  if (!(await isPickemOpen(EVENT_ID))) {
    return NextResponse.json(PICKEM_NOT_OPEN_ERROR, { status: 409 });
  }

  const result = await mirrorPlayerPredictions(session.playerId, EVENT_ID);
  return NextResponse.json(result);
}
