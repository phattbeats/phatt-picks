/**
 * POST /api/push/subscribe — store the session player's Web Push subscription.
 * Session-gated. Body = the browser PushSubscription JSON
 * ({ endpoint, keys: { p256dh, auth } }). Idempotent on endpoint.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    sub = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Malformed subscription" }, { status: 400 });
  }

  const keys = JSON.stringify({ p256dh, auth });
  // Re-subscribing (same endpoint) re-binds it to this player and refreshes keys.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { playerId: session.playerId, keys },
    create: { playerId: session.playerId, endpoint, keys },
  });

  return NextResponse.json({ ok: true });
}
