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
import { validatePickAgainstLayout } from "@/lib/layout";
import { getEffectiveLayout } from "@/lib/layout-state";
import { isStageWritable } from "@/lib/reveal-core";
import { isLockTimePassed } from "@/lib/lock-schedule-core";
import { currentEventId } from "@/lib/events-core";
import { isWriteFrozenById } from "@/lib/event-freeze";
import { isPlayoffSection, PLAYOFF_ROUNDS, playoffFieldTeams } from "@/lib/playoff-bracket-core";

export async function GET(req: NextRequest) {
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
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
  const EVENT_ID = currentEventId(); // per-request active event (PHA-1046)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { eventId = EVENT_ID, sectionId, picks } = body;

  if (!Array.isArray(picks) || !sectionId) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const evtId = Number(eventId);
  const secId = Number(sectionId);

  // PHA-949/954: an effectively-archived Major is frozen, read-only history —
  // refuse every write up front, independent of the per-stage lock gate (its
  // lock schedule may not even be in scope once another Major is live). Keyed on
  // EFFECTIVE status (clock + real Grand-Final-resolved signal), so the freeze
  // fires on the actual GF with no human flip. No-op for the live event.
  if (await isWriteFrozenById(evtId)) {
    return NextResponse.json({ error: "event_archived" }, { status: 409 });
  }

  const layout = await getEffectiveLayout(evtId);
  const section = layout.sections.find((s) => s.sectionid === secId);
  if (!section) {
    return NextResponse.json({ error: `unknown section ${secId}` }, { status: 400 });
  }

  // PHA-1204: the playoffs are ONE stage — you fill the whole QF→SF→GF bracket at
  // once. So a Semifinal / Grand Final write must be allowed the moment the
  // bracket OPENS (the QF round seeds), not gated on its own round, whose teams
  // are still TBD and whose picks_allowed flag Valve may flip independently. Gate
  // every playoff section's write on the Quarterfinals: writable until any
  // playoff match resolves or the QF's published start passes.
  const playoff = isPlayoffSection(secId);
  const playoffSectionIds = PLAYOFF_ROUNDS.map((r) => r.sectionId);
  const lockSectionId = playoff ? PLAYOFF_ROUNDS[0].sectionId : secId;
  const lockSection = playoff
    ? layout.sections.find((s) => s.sectionid === lockSectionId) ?? section
    : section;

  // A resolved outcome for any slot in the gating section proves the stage
  // closed, even if the layout snapshot we hold still says picks_allowed:true.
  // For playoffs, ANY resolved playoff match closes the whole bracket.
  const resolvedCount = await prisma.stageOutcome.count({
    where: playoff
      ? { eventId: evtId, sectionId: { in: playoffSectionIds } }
      : { eventId: evtId, sectionId: secId },
  });
  const hasOutcome = resolvedCount > 0;

  // The committed fixture is frozen all-open, so `picks_allowed` never flips for
  // it. Once a stage's published lock instant passes it has begun — reject the
  // write so a crafted POST can't slip a pick past the (now Locked) UI (PHA-898).
  // Same lockedByTime signal the reveal gate uses, so writable and revealed stay
  // exact inverses (no edit-but-can't-compare dead zone).
  const lockedByTime = isLockTimePassed(lockSectionId, Date.now());

  if (lockSection.groups.some((g) => !isStageWritable(g, hasOutcome, lockedByTime))) {
    return NextResponse.json({ error: "stage_locked" }, { status: 409 });
  }

  // Eligibility universe for a downstream playoff pick (PHA-1204): your SF/GF
  // call is one of the eight survivors you advanced, none of which the layout has
  // placed on the SF/GF group slots yet. So validate such a pick against the
  // whole playoff field (the QF-seeded teams), not its own — still-TBD — group.
  const playoffField = playoff ? playoffFieldTeams(layout.sections) : null;

  // Per-pick validation below only checks a slot exists and the team is eligible.
  // It does NOT stop a crafted batch from putting the SAME team in two slots, or
  // sending more picks than a group has slots — either of which writes an illegal
  // local board (the leaderboard's source of truth). Guard the batch as a whole:
  // within any group, non-zero picks must be unique and not exceed the slot count.
  const byGroup = new Map<number, number[]>();
  for (const pick of picks) {
    const gId = Number(pick.groupId);
    const pId = Number(pick.pickId);
    if (pId === 0) continue; // a cleared slot never collides
    const seen = byGroup.get(gId) ?? [];
    if (seen.includes(pId)) {
      return NextResponse.json(
        { error: `duplicate team ${pId} in group ${gId}` },
        { status: 400 },
      );
    }
    seen.push(pId);
    byGroup.set(gId, seen);
  }
  for (const [gId, teams] of byGroup) {
    const group = section.groups.find((g) => g.groupid === gId);
    if (group && teams.length > group.picks.length) {
      return NextResponse.json(
        { error: `too many picks for group ${gId} (${teams.length} > ${group.picks.length})` },
        { status: 400 },
      );
    }
  }

  const upserts = [];

  for (const pick of picks) {
    const { groupId, slotIndex, pickId, itemId } = pick;
    const gId = Number(groupId);
    const sIdx = Number(slotIndex);
    const pId = Number(pickId);

    const reason = validatePickAgainstLayout(layout, secId, gId, sIdx, pId);
    if (reason) {
      // A downstream playoff pick targets a team seeded in the QF section, not in
      // its own group — accept it when it's one of the eight playoff survivors;
      // every other failure (unknown slot/group, off-field team) still rejects.
      const playoffAdvance =
        playoffField != null &&
        pId !== 0 &&
        playoffField.has(pId) &&
        reason === `team ${pId} not eligible for group ${gId}`;
      if (!playoffAdvance) {
        return NextResponse.json({ error: `invalid pick: ${reason}` }, { status: 400 });
      }
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
