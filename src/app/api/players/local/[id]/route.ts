/**
 * DELETE /api/players/local/[id] — owner-only hard delete of a local player.
 *
 * Refuses to delete a player whose `steamId` is set OR `isLocal` is false —
 * this endpoint is only for clearing out test/guest accounts that never
 * paired Steam. Real Steam players have to be handled deliberately, not
 * through this route.
 *
 * Cascade is handled by Prisma: Pick + PushSubscription have onDelete:
 * Cascade against Player, so the leaderboard and notification surface both
 * recover automatically on next read. See PHA-854.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;

  const target = await prisma.player.findUnique({
    where: { id },
    select: { id: true, isLocal: true, steamId: true, displayName: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!target.isLocal || target.steamId !== null) {
    return NextResponse.json(
      { error: "not_local", message: "Refusing to delete a Steam-linked player through this endpoint." },
      { status: 400 },
    );
  }

  if (target.id === session.playerId) {
    return NextResponse.json(
      { error: "self_delete", message: "Cannot delete your own player record." },
      { status: 400 },
    );
  }

  await prisma.player.delete({ where: { id } });

  return NextResponse.json({ deleted: { id: target.id, displayName: target.displayName } });
}
