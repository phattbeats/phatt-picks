/**
 * PHA-4101: arcade `DELETE /me` hook. POST {sub} signed by the arcade (phattbeats/arcade src/erase.js forgetHook).
 * Deletes the Hotline player linked to that PHATT ID with its picks, locks, ranks, pushes and reactions
 * (Prisma cascades + the denormalised reaction rows). Idempotent: an unknown sub is 204 too.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPhattIdSub } from "@/lib/phatt-id-core";
import { hookAuthorized } from "../_verify";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!hookAuthorized(req, raw)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  let sub: unknown;
  try {
    sub = JSON.parse(raw)?.sub;
  } catch {}
  if (!isPhattIdSub(sub)) return NextResponse.json({ error: "bad_sub" }, { status: 400 });
  const p = await prisma.player.findUnique({ where: { phattIdSub: sub }, select: { id: true } });
  if (p) {
    await prisma.$transaction([
      prisma.reaction.deleteMany({ where: { OR: [{ senderId: p.id }, { targetPlayerId: p.id }] } }),
      prisma.player.updateMany({ where: { invitedById: p.id }, data: { invitedById: null } }),
      prisma.player.delete({ where: { id: p.id } }),
    ]);
    console.log("arcade forget hook: player erased");
  }
  return new NextResponse(null, { status: 204 });
}
