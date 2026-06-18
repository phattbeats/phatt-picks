/**
 * Universal in-app notifications (PHA-1211 follow-up; PHA-1237 per-item read
 * state; PHA-1236 inbox page support; PHA-1241 SSE delivery).
 *
 * GET  /api/notifications?limit=N  → { unread, total, generatedAtMs, items[] }
 *   for the signed-in player. One feed across kinds: reactions on their picks,
 *   upcoming stage locks, "your recap is ready", and broadcast announcements.
 *   Everything is DERIVED (reaction rows + clock + committed lock schedule +
 *   latest resolved stage + NotificationRead rows) — no Notification table.
 *   `limit` defaults to 8 (bell peek); the inbox page passes 30.
 *
 * POST /api/notifications  { action: "readAll" }
 *   → watermark-style bulk clear: sets notificationsSeenAt = now on the player.
 *
 * POST /api/notifications  { action: "read", entryId: string }
 *   → per-entry explicit read: upserts a NotificationRead row (PHA-1237).
 *
 * Both POST variants are same-origin guarded (isSameOrigin).
 *
 * buildPlayerFeed is exported for the SSE stream handler (/stream/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/csrf";
import { currentEventId, currentEvent } from "@/lib/events-core";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { lockTimeForSection } from "@/lib/lock-schedule-core";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import { announcementEntries } from "@/lib/announcements-core";
import type { OutcomeMap } from "@/lib/scoring";
import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  assembleFeed,
  filterEntriesByPrefs,
  parseNotifPrefs,
  type NotifReaction,
  type PickLabeller,
  type ReadContext,
} from "@/lib/notifications-core";

const DEFAULT_LIMIT = 8;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number.parseInt(limitParam, 10) || DEFAULT_LIMIT)) : DEFAULT_LIMIT;

  return NextResponse.json(await buildPlayerFeed(session.playerId, limit));
}

/** Build the notification feed for a player. Exported for the SSE stream
 *  (/stream/route.ts) so both endpoints deliver identical payloads. */
export async function buildPlayerFeed(playerId: string, limit: number = DEFAULT_LIMIT) {
  const eventId = currentEventId();
  const nowMs = Date.now();
  const [reactions, player, myPicks, outcomes, reads] = await Promise.all([
    prisma.reaction.findMany({
      where: { eventId, targetPlayerId: playerId },
      select: { stampId: true, sectionId: true, groupId: true, slotIndex: true, createdAt: true },
    }),
    prisma.player.findUnique({
      where: { id: playerId },
      select: { notificationsSeenAt: true, notifPrefs: true },
    }),
    prisma.pick.findMany({
      where: { eventId, playerId },
      select: { sectionId: true, groupId: true, slotIndex: true, pickId: true },
    }),
    prisma.stageOutcome.findMany({
      where: { eventId },
      select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true, resolvedAt: true },
    }),
    prisma.notificationRead.findMany({
      where: { playerId },
      select: { entryId: true, readAt: true },
    }),
  ]);

  const seenAtMs = player?.notificationsSeenAt ? player.notificationsSeenAt.getTime() : 0;
  const readSet = new Set<string>();
  const readAtByEntry = new Map<string, number>();
  for (const r of reads) {
    readSet.add(r.entryId);
    readAtByEntry.set(r.entryId, r.readAt.getTime());
  }
  const rc: ReadContext = { seenAtMs, readSet, readAtByEntry };
  const prefs = parseNotifPrefs(player?.notifPrefs);

  const layout = getCommittedLayout();
  const teamMap = buildTeamMap(layout);
  const event = currentEvent(nowMs);
  const stageName = (sectionId: number): string =>
    event.sectionNames[sectionId] ??
    layout.sections.find((s) => s.sectionid === sectionId)?.name.split(" | ")[0] ??
    "Stage";

  const rawEntries = [];

  rawEntries.push(...announcementEntries(nowMs));

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
  rawEntries.push(...reactionEntries(reactionRows, label));

  for (const s of layout.sections) {
    const iso = lockTimeForSection(s.sectionid);
    if (!iso) continue;
    const e = stageLockEntry(
      { sectionId: s.sectionid, stageName: stageName(s.sectionid), lockAtMs: Date.parse(iso) },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }

  const outcomeMap: OutcomeMap = {};
  const resolvedAtBySection = new Map<number, number>();
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
    resolvedAtBySection.set(
      o.sectionId,
      Math.max(resolvedAtBySection.get(o.sectionId) ?? 0, o.resolvedAt.getTime()),
    );
  }
  const recapSection = latestWrappedSectionId(layout, outcomeMap);
  if (recapSection != null) {
    const e = recapEntry(
      {
        sectionId: recapSection,
        stageName: stageName(recapSection),
        resolvedAtMs: resolvedAtBySection.get(recapSection) ?? 0,
      },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }

  return assembleFeed(filterEntriesByPrefs(rawEntries, prefs), rc, limit, nowMs);
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, reason: "bad-origin" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = (body as Record<string, unknown>)?.action;

  if (action === "read") {
    const entryId = (body as Record<string, unknown>)?.entryId;
    if (typeof entryId !== "string" || !entryId) {
      return NextResponse.json({ ok: false, reason: "missing-entryId" }, { status: 400 });
    }
    await prisma.notificationRead.upsert({
      where: { playerId_entryId: { playerId: session.playerId, entryId } },
      create: { playerId: session.playerId, entryId },
      update: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  // "readAll" (or bare POST for legacy bell behaviour) → watermark bulk-clear.
  await prisma.player.update({
    where: { id: session.playerId },
    data: { notificationsSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true, unread: 0 });
}
