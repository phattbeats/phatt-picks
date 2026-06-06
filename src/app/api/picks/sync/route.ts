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
import { ACTIVE_EVENT_ID } from "@/lib/events-core";

const EVENT_ID = ACTIVE_EVENT_ID;
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const result = await mirrorPlayerPredictions(session.playerId, EVENT_ID);
  return NextResponse.json(result);
}
