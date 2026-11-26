/**
 * stage-end-pushes - fan-out push when a Swiss stage fully resolves (PHA-5498).
 *
 * The notice says the stage is over and nothing else: no result, no score.
 * That is the whole point of spoiler-free mode - it tells the player it is
 * now safe to turn the veil off and look, without spoiling it in the notice
 * itself.
 *
 * Runs on every scheduler tick (instrumentation.ts). An in-process `fired` Set
 * sends at most one stage-end push per stage per process lifetime (the same
 * pattern as recap-pushes). A process restart re-arms the set - at worst one
 * duplicate, which the notification `tag` collapses client-side.
 *
 * Who gets it:
 *   - a player with a push subscription (a signed-out player has none), and
 *   - a player whose `stageEnd.push` preference is on.
 *
 * When it fires: when EVERY pick slot of a Swiss stage has a resolved outcome
 * (`latestCompletedSwissSectionId`). The stage-complete rule itself lives in
 * the shared, DB-free core (`stage-wrapped-launch-core`), so the picks page,
 * the recap push and this push agree on what "the stage is over" means.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildStageEndPayload } from "@/lib/notify-core";
import { parseNotifPrefs } from "@/lib/notifications-core";
import { latestCompletedSwissSectionId } from "@/lib/stage-end-core";
import { scoringLayoutFor } from "@/lib/layout-state";
import { currentEventId, currentEvent } from "@/lib/events-core";
import type { OutcomeMap } from "@/lib/scoring";

/** sectionIds whose stage-end push has already fired this process lifetime. */
const fired = new Set<number>();

export async function runStageEndPushes(now: number = Date.now()): Promise<void> {
  const eventId = currentEventId(now);
  const layout = await scoringLayoutFor(eventId);

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

  const sectionId = latestCompletedSwissSectionId(layout, outcomeMap);
  if (sectionId == null || fired.has(sectionId)) return;

  const event = currentEvent(now);
  const stageName =
    event.sectionNames[sectionId] ??
    layout.sections.find((s) => s.sectionid === sectionId)?.name.split(" | ")[0] ??
    "Stage";

  const subbed = await prisma.pushSubscription.findMany({
    select: { playerId: true },
    distinct: ["playerId"],
  });

  // Mark fired before the fan-out so a DB error on one player doesn't re-fire
  // the whole batch on the next tick.
  fired.add(sectionId);

  if (subbed.length === 0) return;

  const playerPrefs = await prisma.player.findMany({
    where: { id: { in: subbed.map((s) => s.playerId) } },
    select: { id: true, notifPrefs: true },
  });
  const prefsById = new Map(playerPrefs.map((p) => [p.id, parseNotifPrefs(p.notifPrefs)]));

  const payload = buildStageEndPayload({ stageName, sectionId });
  let sent = 0;
  for (const { playerId } of subbed) {
    if (!prefsById.get(playerId)?.stageEnd.push) continue;
    const outcome = await sendPushToPlayer(playerId, payload);
    sent += outcome.sent;
  }

  console.log(`[stage-end-push] section ${sectionId} (${stageName}): ${sent} push(es)`);
}
