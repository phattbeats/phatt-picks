/**
 * POST /api/push/unsubscribe — remove a push subscription for the session player.
 * Session-gated. Body = { endpoint }. No-op if the endpoint isn't ours.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: body.endpoint, playerId: session.playerId },
  });

  return NextResponse.json({ ok: true });
}
