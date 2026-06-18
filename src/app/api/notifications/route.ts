/**
 * Universal in-app notifications (PHA-1211 follow-up).
 *
 * GET  /api/notifications  → { unread, items[] } for the signed-in player. One
 *   feed across kinds: reactions on their picks, upcoming stage locks, and "your
 *   recap is ready". Everything is DERIVED (reaction rows + clock + committed
 *   lock schedule + latest resolved stage) — no Notification table. "unread"
 *   counts entries newer than the player's notificationsSeenAt watermark, so the
 *   feed never backfills passed stages or stale recaps.
 *
 * POST /api/notifications  → marks everything seen (notificationsSeenAt = now).
 *   Same-origin guarded.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId, currentEvent } from "@/lib/events-core";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { lockTimeForSection } from "@/lib/lock-schedule-core";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import type { OutcomeMap } from "@/lib/scoring";
import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  assembleFeed,
  type NotifEntry,
  type NotifReaction,
  type PickLabeller,
} from "@/lib/notifications-core";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const eventId = currentEventId();
  const nowMs = Date.now();
  const [reactions, player, myPicks, outcomes] = await Promise.all([
    prisma.reaction.findMany({
      where: { eventId, targetPlayerId: session.playerId },
      select: { stampId: true, sectionId: true, groupId: true, slotIndex: true, createdAt: true },
    }),
    prisma.player.findUnique({ where: { id: session.playerId }, select: { notificationsSeenAt: true } }),
    prisma.pick.findMany({
      where: { eventId, playerId: session.playerId },
      select: { sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({
      where: { eventId },
      select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true, resolvedAt: true },
    }),
  ]);

  const seenAtMs = player?.notificationsSeenAt ? player.notificationsSeenAt.getTime() : 0;

  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const event = currentEvent(nowMs);
  const stageName = (sectionId: number): string =>
    event.sectionNames[sectionId] ??
    layout.sections.find((s) => s.sectionid === sectionId)?.name.split(" | ")[0] ??
    "Stage";

  const entries: NotifEntry[] = [];

  // 1. Reactions on your picks (team name resolved from the slot you picked).
  const pickByKey = new Map<string, number>();
  for (const p of myPicks) pickByKey.set(`${p.sectionId}:${p.groupId}:${p.slotIndex}`, p.pickId);
  const label: PickLabeller = (sectionId, groupId, slotIndex) => {
    const pickId = pickByKey.get(`${sectionId}:${groupId}:${slotIndex}`);
    const team = pickId ? teamMap.get(pickId) : undefined;
    return { teamName: team?.name ?? null, stageLabel: stageName(sectionId) };
  };
  const reactionRows: NotifReaction[] = reactions.map((r) => ({
    stampId: r.stampId,
    sectionId: r.sectionId,
    groupId: r.groupId,
    slotIndex: r.slotIndex,
    createdAtMs: r.createdAt.getTime(),
  }));
  entries.push(...reactionEntries(reactionRows, seenAtMs, label));

  // 2. Upcoming stage locks (only future locks within the lead window).
  for (const s of layout.sections) {
    const iso = lockTimeForSection(s.sectionid);
    if (!iso) continue;
    const e = stageLockEntry(
      { sectionId: s.sectionid, stageName: stageName(s.sectionid), lockAtMs: Date.parse(iso) },
      nowMs,
      seenAtMs,
    );
    if (e) entries.push(e);
  }

  // 3. "Your recap is ready" for the latest resolved + authored stage.
  const outcomeMap: OutcomeMap = {};
  const resolvedAtBySection = new Map<number, number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    resolvedAtBySection.set(o.sectionId, Math.max(resolvedAtBySection.get(o.sectionId) ?? 0, o.resolvedAt.getTime()));
  }
  const recapSection = latestWrappedSectionId(layout, outcomeMap);
  if (recapSection != null) {
    const e = recapEntry(
      { sectionId: recapSection, stageName: stageName(recapSection), resolvedAtMs: resolvedAtBySection.get(recapSection) ?? 0 },
      nowMs,
      seenAtMs,
    );
    if (e) entries.push(e);
  }

  return NextResponse.json(assembleFeed(entries));
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await prisma.player.update({
    where: { id: session.playerId },
    data: { notificationsSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true, unread: 0 });
}
