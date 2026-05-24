/**
 * Picks API — GET (read player's picks) and POST (upsert a batch).
 *
 * POST body: { eventId, sectionId, picks: [{ groupId, slotIndex, pickId, itemId }] }
 * itemId must be a digit string (bigint). Never accept it as a number.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { assertBigIntString } from "@/lib/bigint";

const EVENT_ID = 26;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const sectionId = searchParams.get("sectionId");

  const picks = await prisma.pick.findMany({
    where: {
      playerId: session.playerId,
      eventId: EVENT_ID,
      ...(sectionId ? { sectionId: parseInt(sectionId, 10) } : {}),
    },
    orderBy: [{ sectionId: "asc" }, { groupId: "asc" }, { slotIndex: "asc" }],
  });

  return NextResponse.json({ picks });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { eventId = EVENT_ID, sectionId, picks } = body;

  if (!Array.isArray(picks) || !sectionId) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const upserts = [];

  for (const pick of picks) {
    const { groupId, slotIndex, pickId, itemId } = pick;

    // Validate itemId is a digit string — never accept as a number
    let safeItemId: string;
    try {
      safeItemId = assertBigIntString(itemId, "itemId");
    } catch {
      return NextResponse.json({ error: `Invalid itemId: ${itemId}` }, { status: 400 });
    }

    upserts.push(
      prisma.pick.upsert({
        where: {
          playerId_eventId_sectionId_groupId_slotIndex: {
            playerId: session.playerId,
            eventId: Number(eventId),
            sectionId: Number(sectionId),
            groupId: Number(groupId),
            slotIndex: Number(slotIndex),
          },
        },
        update: {
          pickId: Number(pickId),
          itemId: safeItemId,
          isLocal: true,
        },
        create: {
          playerId: session.playerId,
          eventId: Number(eventId),
          sectionId: Number(sectionId),
          groupId: Number(groupId),
          slotIndex: Number(slotIndex),
          pickId: Number(pickId),
          itemId: safeItemId,
          isLocal: true,
        },
      })
    );
  }

  const results = await prisma.$transaction(upserts);
  return NextResponse.json({ saved: results.length });
}
