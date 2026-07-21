/**
 * buildPlayerFeed — the single server-side assembler for a player's universal
 * notification feed (PHA-1236 review extraction).
 *
 * This used to be copy-pasted into THREE places (GET /api/notifications, the SSE
 * stream via a route→route import, and the /notifications inbox page). The copies
 * drifted: the inbox page never got the PHA-1245 playoff-lock collapse, so it
 * would have surfaced one "locks soon" entry per playoff round (QF/SF/GF) while
 * the bell showed a single "Playoffs" entry. Hoisting the one true implementation
 * here keeps the bell, the stream, and the inbox byte-for-byte identical.
 *
 * Server-only (touches prisma) — imported by the API route, the SSE stream, and
 * the inbox RSC. The pure grouping/read-state/limit math still lives in
 * notifications-core; this layer only gathers the DB inputs and feeds them in.
 */

import { prisma } from "@/lib/db";
import { currentEventId, currentEvent } from "@/lib/events-core";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { lockTimeForSection, playoffSectionIds, PLAYOFF_STAGE_NAME } from "@/lib/lock-schedule-core";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import { announcementEntries } from "@/lib/announcements-core";
import type { OutcomeMap } from "@/lib/scoring";
import {
  reactionEntries,
  stageLockEntry,
  recapEntry,
  coinEarnedEntry,
  assembleFeed,
  filterEntriesByPrefs,
  parseNotifPrefs,
  type FeedView,
  type NotifReaction,
  type PickLabeller,
  type ReadContext,
} from "@/lib/notifications-core";
import { getPlayerChallengeCoins } from "@/lib/challenge-coins";

export const DEFAULT_FEED_LIMIT = 8;

/** Build the notification feed for a player. Used by the API route, the SSE
 *  stream, and the inbox page so all three deliver identical payloads. */
export async function buildPlayerFeed(
  playerId: string,
  limit: number = DEFAULT_FEED_LIMIT,
): Promise<FeedView> {
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

  const rawEntries: Omit<import("@/lib/notifications-core").NotifEntry, "isNew" | "readAt">[] = [];

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

  // Playoffs are ONE bracket Pick'Em (QF/SF/GF lock together at the first QF), so
  // they get a SINGLE "Playoffs locks soon" entry, not one per round (PHA-1245) —
  // mirrors the push reminder collapse in stageLocksFromSchedule.
  const playoffIds = playoffSectionIds(event.playoffSchedule);
  let earliestPlayoff: { sectionId: number; lockAtMs: number } | null = null;
  for (const s of layout.sections) {
    const iso = lockTimeForSection(s.sectionid, event.lockSchedule);
    if (!iso) continue;
    const lockAtMs = Date.parse(iso);
    if (playoffIds.has(s.sectionid)) {
      if (earliestPlayoff === null || lockAtMs < earliestPlayoff.lockAtMs) {
        earliestPlayoff = { sectionId: s.sectionid, lockAtMs };
      }
      continue;
    }
    const e = stageLockEntry(
      { sectionId: s.sectionid, stageName: stageName(s.sectionid), lockAtMs },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }
  if (earliestPlayoff !== null) {
    const e = stageLockEntry(
      { sectionId: earliestPlayoff.sectionId, stageName: PLAYOFF_STAGE_NAME, lockAtMs: earliestPlayoff.lockAtMs },
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

  // Challenge coins earned (PHA-1278) — one entry per concluded Major the player
  // took part in. getPlayerChallengeCoins is cross-event and short-circuits the
  // live event, so this is empty (and cheap) until a Major archives.
  const coins = await getPlayerChallengeCoins(playerId, nowMs);
  for (const c of coins) {
    const e = coinEarnedEntry(
      { eventId: c.eventId, eventName: c.name, tier: c.tier, earnedAtMs: c.earnedAtMs },
      nowMs,
    );
    if (e) rawEntries.push(e);
  }

  return assembleFeed(filterEntriesByPrefs(rawEntries, prefs), rc, limit, nowMs);
}
