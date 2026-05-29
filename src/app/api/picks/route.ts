/**
 * Picks API — GET (read player's picks) and POST (upsert a batch).
 *
 * POST body: { eventId, sectionId, picks: [{ groupId, slotIndex, pickId, itemId }] }
 * itemId is a digit string (bigint) — never accept it as a number — or "" when
 * the player just set the pick locally and Valve hasn't assigned an itemid yet
 * (the write path resolves it from GetTournamentItems at upload time).
 * pickId 0 = clear/TBD.
 *
 * Spec §7: "Saving a pick == locking it." The handler refuses any write to a
 * section whose stage has closed (picks_allowed flipped off OR a StageOutcome
 * already exists for any slot in the section), and refuses any individual pick
 * whose (section, group, slot) is not in the committed layout or whose non-zero
 * pickId is not an eligible team for that group. The whole batch is rejected
 * on the first violation so a partial write can't half-lock a stage. Admin
 * (owner) lock exemption per spec §7 isn't built yet — beta keeps the lock
 * absolute and we revisit when an admin notion lands.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { assertBigIntString } from "@/lib/bigint";
import { getCommittedLayout, validatePickAgainstLayout } from "@/lib/layout";
import { isStageWritable } from "@/lib/reveal-core";

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

  const evtId = Number(eventId);
  const secId = Number(sectionId);

  const layout = getCommittedLayout();
  const section = layout.sections.find((s) => s.sectionid === secId);
  if (!section) {
    return NextResponse.json({ error: `unknown section ${secId}` }, { status: 400 });
  }

  // A resolved outcome for any slot in this section proves the stage closed,
  // even if the layout snapshot we hold still says picks_allowed:true.
  const resolvedCount = await prisma.stageOutcome.count({
    where: { eventId: evtId, sectionId: secId },
  });
  const hasOutcome = resolvedCount > 0;

  if (section.groups.some((g) => !isStageWritable(g, hasOutcome))) {
    return NextResponse.json({ error: "stage_locked" }, { status: 409 });
  }

  const upserts = [];

  for (const pick of picks) {
    const { groupId, slotIndex, pickId, itemId } = pick;
    const gId = Number(groupId);
    const sIdx = Number(slotIndex);
    const pId = Number(pickId);

    const reason = validatePickAgainstLayout(layout, secId, gId, sIdx, pId);
    if (reason) {
      return NextResponse.json({ error: `invalid pick: ${reason}` }, { status: 400 });
    }

    // Clearing a slot (pickId 0) leaves itemId empty by design; only enforce
    // the bigint-string shape when we're actually locking a real pick.
    let safeItemId: string;
    if (pId === 0 || itemId === undefined || itemId === null || itemId === "") {
      safeItemId = "";
    } else {
      try {
        safeItemId = assertBigIntString(itemId, "itemId");
      } catch {
        return NextResponse.json({ error: `Invalid itemId: ${itemId}` }, { status: 400 });
      }
    }

    upserts.push(
      prisma.pick.upsert({
        where: {
          playerId_eventId_sectionId_groupId_slotIndex: {
            playerId: session.playerId,
            eventId: evtId,
            sectionId: secId,
            groupId: gId,
            slotIndex: sIdx,
          },
        },
        update: {
          pickId: pId,
          itemId: safeItemId,
          isLocal: true,
        },
        create: {
          playerId: session.playerId,
          eventId: evtId,
          sectionId: secId,
          groupId: gId,
          slotIndex: sIdx,
          pickId: pId,
          itemId: safeItemId,
          isLocal: true,
        },
      })
    );
  }

  const results = await prisma.$transaction(upserts);
  return NextResponse.json({ saved: results.length });
}
