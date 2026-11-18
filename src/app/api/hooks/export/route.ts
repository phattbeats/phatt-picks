/** PHA-4101: arcade `GET /me/export` hook. GET ?sub= signed over "sub=<sub>". */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPhattIdSub } from "@/lib/phatt-id-core";
import { hookAuthorized } from "../_verify";

export async function GET(req: NextRequest) {
  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  if (!hookAuthorized(req, `sub=${sub}`)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  if (!isPhattIdSub(sub)) return NextResponse.json({ error: "bad_sub" }, { status: 400 });
  const p = await prisma.player.findUnique({
    where: { phattIdSub: sub },
    select: {
      displayName: true, steamId: true, isLocal: true, hasViewerPass: true, hasValveCoin: true, coinTier: true,
      loadout: true, createdAt: true,
      picks: { select: { eventId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true, itemId: true, isLocal: true, updatedAt: true } },
    },
  });
  return NextResponse.json({ hotline: p ?? null });
}
