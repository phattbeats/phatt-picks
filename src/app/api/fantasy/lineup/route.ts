/**
 * Fantasy lineup API (PHA-5454) — POST saves the signed-in manager's five for
 * one stage of the current Major.
 *
 * Body: { stageId, lineup: { slots: [{ playerId, role }] x5, captainId }, teamName? }
 * `playerId` is an HLTV player id. The rules are enforced server-side
 * (fantasy-core validateLineup): one per tier, at most two per team, five
 * different roles, captain in the five. An open stage can be re-saved; a live
 * stage accepts one late entry and no edits; a final stage accepts nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId } from "@/lib/events-core";
import { isWriteFrozenById } from "@/lib/event-freeze";
import { saveLineup } from "@/lib/fantasy";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isSameOrigin(req)) return NextResponse.json({ error: "bad_origin" }, { status: 403 });

  let body: { stageId?: unknown; lineup?: unknown; teamName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const stageId = Number(body.stageId);
  if (!Number.isInteger(stageId)) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const eventId = currentEventId();
  if (await isWriteFrozenById(eventId)) return NextResponse.json({ error: "event_archived" }, { status: 409 });

  const result = await saveLineup({
    managerId: session.playerId,
    eventId,
    stageId,
    lineup: body.lineup,
    teamName: body.teamName,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, problems: result.problems ?? [] }, { status: result.status });
  }
  return NextResponse.json({ ok: true, lockedAt: new Date(result.lockedAtMs).toISOString(), late: result.late });
}
