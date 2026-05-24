/**
 * POST /api/push/test — send a sample pre-lock reminder to the session player's
 * own devices. Backs the DoD: "an opted-in user receives a test pre-lock push."
 * Session-gated; always 200 with a structured outcome (sent/failed/pruned).
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isPushConfigured, sendTestPreLockPush } from "@/lib/notify";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json({ ok: false, reason: "push-not-configured", sent: 0 });
  }

  const outcome = await sendTestPreLockPush(session.playerId);
  return NextResponse.json({ ok: true, ...outcome });
}
