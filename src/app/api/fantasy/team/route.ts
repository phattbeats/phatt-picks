/**
 * Fantasy team name (PHA-5454) — POST { name } renames the signed-in manager's
 * fantasy team for the current Major. The name is cleaned and capped at 28
 * characters (fantasy-core cleanTeamName); it can be changed at any time.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId } from "@/lib/events-core";
import { isWriteFrozenById } from "@/lib/event-freeze";
import { hasFantasy, saveTeamName } from "@/lib/fantasy";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isSameOrigin(req)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const eventId = currentEventId();
  if (!hasFantasy(eventId)) return NextResponse.json({ error: "no_fantasy" }, { status: 404 });
  if (await isWriteFrozenById(eventId)) return NextResponse.json({ error: "event_archived" }, { status: 409 });
  const name = await saveTeamName(session.playerId, eventId, body.name);
  if (!name) return NextResponse.json({ error: "empty_name" }, { status: 400 });
  return NextResponse.json({ ok: true, name });
}
