/**
 * send-prelock-reminders — the pre-lock reminder job (handoff §3 scheduler, §8.5).
 *
 * Runs in the app runtime (the in-container sidecar / cron, via tsx or the
 * compiled build — NOT bare node, since it uses the `@/` alias + web-push + DB).
 * The pure decision logic it calls (dueReminders / buildPreLockPayload /
 * isReminderRecipient) lives in notify-core and is verified offline.
 *
 * Stage lock times come from STAGE_LOCKS_JSON (set by the owner once Valve
 * publishes the Cologne cutoffs), shaped:
 *   {"105":{"name":"Stage I","lockAt":"2026-06-02T09:00:00Z"}, ...}
 * Absent/empty → safe no-op (we never invent a cutoff). Designed to be run on a
 * short cadence (e.g. every 5 min); notify-core's fire-window makes that idempotent.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildPreLockPayload, dueReminders, isReminderRecipient } from "@/lib/notify-core";

const EVENT_ID = Number(process.env.EVENT_ID ?? 26);

interface StageLock {
  name: string;
  lockAt: string; // ISO
}

function loadStageLocks(): Record<number, StageLock> {
  const raw = process.env.STAGE_LOCKS_JSON;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<number, StageLock>;
  } catch {
    console.error("[prelock] STAGE_LOCKS_JSON is not valid JSON; skipping");
    return {};
  }
}

export async function runPreLockReminders(now: number = Date.now()): Promise<void> {
  const locks = loadStageLocks();
  const sectionIds = Object.keys(locks);
  if (sectionIds.length === 0) {
    console.log("[prelock] no STAGE_LOCKS_JSON configured — nothing to do");
    return;
  }

  for (const sid of sectionIds) {
    const sectionId = Number(sid);
    const { name, lockAt } = locks[sectionId];
    const lockAtMs = Date.parse(lockAt);
    if (Number.isNaN(lockAtMs)) {
      console.error(`[prelock] section ${sectionId} has invalid lockAt "${lockAt}"`);
      continue;
    }

    const due = dueReminders(now, lockAtMs);
    if (due.length === 0) continue;

    // Opted-in players = those with at least one push subscription.
    const subbed = await prisma.pushSubscription.findMany({
      select: { playerId: true },
      distinct: ["playerId"],
    });

    let sent = 0;
    for (const { playerId } of subbed) {
      const locked = await prisma.pick.count({
        where: { playerId, eventId: EVENT_ID, sectionId, pickId: { not: 0 } },
      });
      if (!isReminderRecipient({ hasSubscription: true, hasLockedStage: locked > 0 })) continue;

      const payload = buildPreLockPayload({ stageName: name, lockAtMs, nowMs: now });
      const outcome = await sendPushToPlayer(playerId, payload);
      sent += outcome.sent;
    }
    console.log(`[prelock] section ${sectionId} (${name}): ${due.map((d) => d.label).join("+")} → ${sent} push(es)`);
  }
}

// Allow direct invocation by the scheduler.
if (process.argv[1] && process.argv[1].includes("send-prelock-reminders")) {
  runPreLockReminders()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[prelock] failed:", err);
      process.exit(1);
    });
}
