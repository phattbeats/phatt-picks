/**
 * Bleachers notifications (PHA-1211 follow-up).
 *
 * GET  /api/notifications  → { unread, items[] } for the signed-in player: the
 *   reactions other players dropped on THEIR picks, grouped by pick, with the
 *   team name + stage label resolved from the layout. "unread" counts reactions
 *   newer than the player's reactionsSeenAt watermark (the header bell badge).
 *
 * POST /api/notifications  → marks everything seen (sets reactionsSeenAt = now),
 *   returns { ok, unread: 0 }. Same-origin guarded; it's a state change.
 *
 * Derived from Reaction rows — no Notification table (see notifications-core).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId } from "@/lib/events-core";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { buildNotifications, type NotifReaction } from "@/lib/notifications-core";
import { pickTargetKey } from "@/lib/bleachers-core";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const eventId = currentEventId();
  const [rows, player, myPicks] = await Promise.all([
    prisma.reaction.findMany({
      where: { eventId, targetPlayerId: session.playerId },
      select: { stampId: true, sectionId: true, groupId: true, slotIndex: true, createdAt: true },
    }),
    prisma.player.findUnique({ where: { id: session.playerId }, select: { reactionsSeenAt: true } }),
    prisma.pick.findMany({
      where: { eventId, playerId: session.playerId },
      select: { sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
  ]);

  const seenAtMs = player?.reactionsSeenAt ? player.reactionsSeenAt.getTime() : 0;
  const notifRows: NotifReaction[] = rows.map((r) => ({
    stampId: r.stampId,
    sectionId: r.sectionId,
    groupId: r.groupId,
    slotIndex: r.slotIndex,
    createdAtMs: r.createdAt.getTime(),
  }));
  const view = buildNotifications(notifRows, seenAtMs);

  // Resolve team name (the team the viewer picked on that slot) + stage label.
  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const pickByKey = new Map<string, number>();
  for (const p of myPicks) pickByKey.set(pickTargetKey(p.sectionId, p.groupId, p.slotIndex), p.pickId);
  const stageLabelById = new Map<number, string>(
    layout.sections.map((s) => [s.sectionid, s.name.split(" | ")[0]] as const),
  );

  const items = view.items.map((it) => {
    const pickId = pickByKey.get(it.key);
    const team = pickId ? teamMap.get(pickId) : undefined;
    return {
      ...it,
      teamName: team?.name ?? null,
      stageLabel: stageLabelById.get(it.sectionId) ?? "",
    };
  });

  return NextResponse.json({ unread: view.unread, items });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await prisma.player.update({
    where: { id: session.playerId },
    data: { reactionsSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true, unread: 0 });
}
