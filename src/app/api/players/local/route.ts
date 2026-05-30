/**
 * GET /api/players/local — owner-only listing of local Player rows.
 *
 * "Local" = `isLocal: true` AND `steamId IS NULL`. Both conditions matter —
 * isLocal can theoretically lag (e.g. mid-link race), and the steamId is the
 * authoritative marker that the player has actually paired Steam. The owner
 * cleans these up after testing or after friends sign in as guests before
 * linking Steam. See PHA-854.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isOwner } from "@/lib/owner";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const players = await prisma.player.findMany({
    where: { isLocal: true, steamId: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      displayName: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { picks: true } },
      picks: {
        select: { updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  const rows = players.map((p) => {
    const lastPickAt = p.picks[0]?.updatedAt ?? null;
    const lastActivity = lastPickAt && lastPickAt > p.updatedAt ? lastPickAt : p.updatedAt;
    return {
      id: p.id,
      displayName: p.displayName,
      pickCount: p._count.picks,
      createdAt: p.createdAt,
      lastActivity,
    };
  });

  return NextResponse.json({ players: rows });
}
