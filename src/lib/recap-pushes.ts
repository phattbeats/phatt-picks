/**
 * recap-pushes — fan-out push when a stage recap becomes available (PHA-1239).
 *
 * Runs on every scheduler tick (instrumentation.ts). An in-process `fired` Set
 * ensures we send at most once per recap section per process lifetime (same
 * pattern as prelock-reminders). A process restart re-arms the set — at worst
 * one duplicate, which the notification `tag` collapses client-side.
 *
 * Only sends to players who have a push subscription AND have `recap.push`
 * enabled in their notification preferences.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildRecapPayload } from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import { getCommittedLayout } from "@/lib/layout";
import { currentEventId, currentEvent } from "@/lib/events-core";
import type { OutcomeMap } from "@/lib/scoring";

/** sectionIds whose recap push has already fired this process lifetime. */
const fired = new Set<number>();

export async function runRecapPushes(now: number = Date.now()): Promise<void> {
  const layout = getCommittedLayout();
  const eventId = currentEventId(now);

  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId },
    select: { sectionId: true, groupId: true, slotIndex: true, winnerPickId: true },
  });

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    (outcomeMap[o.sectionId] ??= {});
    (outcomeMap[o.sectionId][o.groupId] ??= {});
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const recapSection = latestWrappedSectionId(layout, outcomeMap);
  if (recapSection == null || fired.has(recapSection)) return;

  const event = currentEvent(now);
  const stageName =
    event.sectionNames[recapSection] ??
    layout.sections.find((s) => s.sectionid === recapSection)?.name.split(" | ")[0] ??
    "Stage";

  const subbed = await prisma.pushSubscription.findMany({
    select: { playerId: true },
    distinct: ["playerId"],
  });

  // Mark fired before the fan-out so a DB error on one player doesn't re-fire
  // the whole batch on the next tick.
  fired.add(recapSection);

  if (subbed.length === 0) return;

  const playerPrefs = await prisma.player.findMany({
    where: { id: { in: subbed.map((s) => s.playerId) } },
    select: { id: true, notifPrefs: true },
  });
  const prefsById = new Map(playerPrefs.map((p) => [p.id, parseNotifPrefs(p.notifPrefs)]));

  const payload = buildRecapPayload({ stageName, sectionId: recapSection });
  let sent = 0;
  for (const { playerId } of subbed) {
    if (!prefsById.get(playerId)?.recap.push) continue;
    const outcome = await sendPushToPlayer(playerId, payload);
    sent += outcome.sent;
  }

  console.log(`[recap-push] section ${recapSection} (${stageName}): ${sent} push(es)`);
}
