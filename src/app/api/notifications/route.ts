/**
 * Universal in-app notifications (PHA-1211 follow-up; PHA-1237 per-item read
 * state; PHA-1236 inbox page support; PHA-1241 SSE delivery).
 *
 * GET  /api/notifications?limit=N  → { unread, total, generatedAtMs, items[] }
 *   for the signed-in player. One feed across kinds: reactions on their picks,
 *   upcoming stage locks, "your recap is ready", and broadcast announcements.
 *   Everything is DERIVED (reaction rows + clock + committed lock schedule +
 *   latest resolved stage + NotificationRead rows) — no Notification table.
 *   `limit` defaults to 8 (bell peek); the inbox page passes 30.
 *
 * POST /api/notifications  { action: "readAll" }
 *   → watermark-style bulk clear: sets notificationsSeenAt = now on the player.
 *
 * POST /api/notifications  { action: "read", entryId: string }
 *   → per-entry explicit read: upserts a NotificationRead row (PHA-1237).
 *
 * Both POST variants are same-origin guarded (isSameOrigin).
 *
 * The feed assembler lives in @/lib/notifications-feed (shared with the SSE
 * stream and the /notifications inbox page so all three stay identical).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { buildPlayerFeed, DEFAULT_FEED_LIMIT } from "@/lib/notifications-feed";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number.parseInt(limitParam, 10) || DEFAULT_FEED_LIMIT)) : DEFAULT_FEED_LIMIT;

  return NextResponse.json(await buildPlayerFeed(session.playerId, limit));
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = (body as Record<string, unknown>)?.action;

  if (action === "read") {
    const entryId = (body as Record<string, unknown>)?.entryId;
    if (typeof entryId !== "string" || !entryId) {
      return NextResponse.json({ ok: false, reason: "missing-entryId" }, { status: 400 });
    }
    await prisma.notificationRead.upsert({
      where: { playerId_entryId: { playerId: session.playerId, entryId } },
      create: { playerId: session.playerId, entryId },
      update: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  // "readAll" (or bare POST for legacy bell behaviour) → watermark bulk-clear.
  await prisma.player.update({
    where: { id: session.playerId },
    data: { notificationsSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true, unread: 0 });
}
