/**
 * POST /api/avatar/clubhouse — a local player chooses a Clubhouse avatar (PHA-5341).
 *
 * Body: { slug }. Only a slug from the pool in src/lib/clubhouse-avatars.ts is
 * accepted; the stored value is built server-side, never taken from the client.
 * Steam players are refused: Steam sign-in overwrites avatarUrl with their Steam
 * picture anyway.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { decideClubhouseAvatarSave } from "@/lib/clubhouse-avatars";

export async function POST(req: NextRequest) {
  const sameOrigin = isSameOrigin(req);
  const session = sameOrigin ? await getSession() : null;

  let slug: unknown = undefined;
  if (sameOrigin && session) {
    const declaredLen = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLen) && declaredLen > 1024) {
      return NextResponse.json({ error: "Invalid body" }, { status: 413 });
    }
    try {
      ({ slug } = await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
  }

  const player = session
    ? await prisma.player.findUnique({ where: { id: session.playerId }, select: { isLocal: true, steamId: true } })
    : null;

  const d = decideClubhouseAvatarSave({ sameOrigin, signedIn: !!session, player, slug });
  if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.status });

  try {
    await prisma.player.update({ where: { id: session!.playerId }, data: { avatarUrl: d.avatarUrl } });
  } catch (err) {
    console.error("Clubhouse avatar update error:", err);
    return NextResponse.json({ error: "Could not save avatar" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, avatarUrl: d.avatarUrl });
}
