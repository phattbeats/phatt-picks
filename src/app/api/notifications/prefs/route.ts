/**
 * GET/PATCH /api/notifications/prefs — read and update per-type notification
 * preferences (PHA-1240). Stored as JSON in Player.notifPrefs; missing keys fall
 * back to DEFAULT_NOTIF_PREFS so a new player gets sensible defaults without
 * requiring a write.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import {
  parseNotifPrefs,
  type NotifPrefs,
} from "@/lib/notifications-core";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const player = await prisma.player.findUnique({
    where: { id: session.playerId },
    select: { notifPrefs: true },
  });

  return NextResponse.json({ prefs: parseNotifPrefs(player?.notifPrefs) });
}

export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { prefs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.prefs || typeof body.prefs !== "object") {
    return NextResponse.json({ error: "Invalid prefs" }, { status: 400 });
  }

  // Normalise through parseNotifPrefs so unknown/partial keys are handled safely.
  const prefs: NotifPrefs = parseNotifPrefs(JSON.stringify(body.prefs));

  await prisma.player.update({
    where: { id: session.playerId },
    data: { notifPrefs: JSON.stringify(prefs) },
  });

  return NextResponse.json({ ok: true, prefs });
}
