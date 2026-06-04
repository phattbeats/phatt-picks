/**
 * prelock-reminders — the pre-lock reminder JOB (PHA-929).
 *
 * Composes the pure decision logic (notify-core: dueReminders /
 * buildPreLockPayload / isReminderRecipient / reminderFireKey) with the DB +
 * web-push transport (notify.ts) to deliver the "24h + 1h before each stage
 * locks" warnings PushToggle promises. Lives in src/lib (not scripts/) so it can
 * be imported by BOTH the in-process scheduler (src/instrumentation.ts) and the
 * scripts/send-prelock-reminders.ts CLI — one code path, no drift.
 *
 * SOURCE OF TRUTH (PHA-929 fix): stage cutoffs come from COLOGNE_LOCK_SCHEDULE
 * via stageLocksFromSchedule — the SAME committed schedule that drives the
 * countdown clock and the pick lock-gate, so a reminder can never fire for a
 * different instant than the UI counts down to. The job used to read a separate
 * STAGE_LOCKS_JSON env that was empty by default, so it silently never fired.
 * STAGE_LOCKS_JSON survives only as an OPTIONAL override (a future major, or
 * playoff sections published out-of-band): when set + valid it replaces the
 * committed map; otherwise the committed schedule is used.
 */

import { prisma } from "@/lib/db";
import { sendPushToPlayer } from "@/lib/notify";
import { buildPreLockPayload, dueReminders, isReminderRecipient, reminderFireKey } from "@/lib/notify-core";
import { stageLocksFromSchedule, type StageLock } from "@/lib/lock-schedule-core";

const EVENT_ID = Number(process.env.EVENT_ID ?? 26);

/**
 * Optional override map from the deploy env (future majors / out-of-band
 * sections). Shaped like {"107":{"name":"Stage III","lockAt":"2026-06-11T10:30:00Z"}}.
 * Absent/blank/garbage → null, and the job falls back to the committed schedule.
 */
function loadOverrideLocks(): Record<number, StageLock> | null {
  const raw = process.env.STAGE_LOCKS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<number, StageLock>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    console.error("[prelock] STAGE_LOCKS_JSON is not valid JSON; using committed schedule");
    return null;
  }
}

function resolveStageLocks(): Record<number, StageLock> {
  return loadOverrideLocks() ?? stageLocksFromSchedule();
}

/**
 * Reminders already dispatched this process lifetime, keyed per
 * (event, section, fireAt). The scheduler runs every ~5 min and notify-core's
 * 15-min fire window keeps a reminder "due" across ~3 ticks; without this set a
 * user would be pinged on every tick inside the window. A process restart re-arms
 * the set — at worst one duplicate, and the notification `tag` collapses it
 * client-side. Bounded (≤ stages × offsets).
 */
const fired = new Set<string>();

/**
 * One scheduler tick: for every committed stage lock, send any reminder whose
 * fire time has arrived (and hasn't been sent this lifetime) to opted-in players
 * who haven't locked that stage yet. Best-effort — every send is wrapped by
 * notify.ts and a missing VAPID config degrades to a no-op. `now` is injectable.
 */
export async function runPreLockReminders(now: number = Date.now()): Promise<void> {
  const locks = resolveStageLocks();
  const sectionIds = Object.keys(locks);
  if (sectionIds.length === 0) {
    console.log("[prelock] no stage locks resolved — nothing to do");
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

    const due = dueReminders(now, lockAtMs).filter(
      (r) => !fired.has(reminderFireKey(EVENT_ID, sectionId, r.fireAtMs)),
    );
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

    // Mark these reminders fired even if sent === 0 (no opted-in recipients yet):
    // the cutoff is fixed, so the same tick won't suddenly gain recipients within
    // its window in a way that warrants re-scanning every 5 min.
    for (const r of due) fired.add(reminderFireKey(EVENT_ID, sectionId, r.fireAtMs));
    console.log(
      `[prelock] section ${sectionId} (${name}): ${due.map((d) => d.label).join("+")} → ${sent} push(es)`,
    );
  }
}
