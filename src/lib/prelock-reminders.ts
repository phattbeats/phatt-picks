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
import { currentEventId, getEventConfig, liveEvents } from "@/lib/events-core";

/** An event's id paired with the stage cutoffs its reminders should fire on. */
interface ReminderTarget {
  eventId: number;
  locks: Record<number, StageLock>;
}

/**
 * Optional override map from the deploy env (out-of-band / playoff sections
 * published before they're committed). Shaped like
 * {"107":{"name":"Stage III","lockAt":"2026-06-11T10:30:00Z"}}.
 * Absent/blank/garbage → null, and the job falls back to the registry schedule.
 */
function loadOverrideLocks(): Record<number, StageLock> | null {
  const raw = process.env.STAGE_LOCKS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<number, StageLock>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    console.error("[prelock] STAGE_LOCKS_JSON is not valid JSON; using registry schedule");
    return null;
  }
}

/**
 * The (event, stage-locks) pairs this tick should reminder on — REGISTRY-DRIVEN
 * (PHA-950). By default we iterate every event that is effectively LIVE right
 * now (`liveEvents`) and read each one's OWN committed `lockSchedule` /
 * `sectionNames` from the registry, so the next Major's reminders fire on its
 * schedule the moment it goes live — nobody re-points this job. Today that is
 * exactly `[Cologne]` with `COLOGNE_LOCK_SCHEDULE`, identical to before.
 *
 * Two operator escape hatches, preserved from PHA-929:
 *   • `STAGE_LOCKS_JSON` — out-of-band cutoffs (e.g. a playoff section published
 *     before it's committed); applies to the pinned/current event as a single
 *     target.
 *   • `EVENT_ID` — pin to one specific event from the registry, even if the
 *     clock wouldn't call it live yet (a manual pre-go-live dry run).
 */
export function reminderTargets(now: number = Date.now()): ReminderTarget[] {
  const envPin = process.env.EVENT_ID ? Number(process.env.EVENT_ID) : null;
  const override = loadOverrideLocks();

  if (override) {
    return [{ eventId: envPin ?? currentEventId(now), locks: override }];
  }

  if (envPin !== null) {
    const pinned = getEventConfig(envPin);
    if (pinned) {
      return [{ eventId: pinned.eventId, locks: stageLocksFromSchedule(pinned.lockSchedule, pinned.sectionNames) }];
    }
    // Pinned to an unregistered id → nothing to do rather than guess.
    return [];
  }

  return liveEvents(now).map((e) => ({
    eventId: e.eventId,
    locks: stageLocksFromSchedule(e.lockSchedule, e.sectionNames),
  }));
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
 * One scheduler tick: for every effectively-live event and each of its stage
 * locks, send any reminder whose fire time has arrived (and hasn't been sent
 * this lifetime) to opted-in players who haven't locked that stage yet. Iterates
 * the registry's live events, so it follows the Major across the calendar with
 * no re-pointing (PHA-950). Best-effort — every send is wrapped by notify.ts and
 * a missing VAPID config degrades to a no-op. `now` is injectable.
 */
export async function runPreLockReminders(now: number = Date.now()): Promise<void> {
  const targets = reminderTargets(now);
  if (targets.length === 0 || targets.every((t) => Object.keys(t.locks).length === 0)) {
    console.log("[prelock] no live event / stage locks resolved — nothing to do");
    return;
  }

  for (const { eventId, locks } of targets) {
    for (const sid of Object.keys(locks)) {
      const sectionId = Number(sid);
      const { name, lockAt } = locks[sectionId];
      const lockAtMs = Date.parse(lockAt);
      if (Number.isNaN(lockAtMs)) {
        console.error(`[prelock] event ${eventId} section ${sectionId} has invalid lockAt "${lockAt}"`);
        continue;
      }

      const due = dueReminders(now, lockAtMs).filter(
        (r) => !fired.has(reminderFireKey(eventId, sectionId, r.fireAtMs)),
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
          where: { playerId, eventId, sectionId, pickId: { not: 0 } },
        });
        if (!isReminderRecipient({ hasSubscription: true, hasLockedStage: locked > 0 })) continue;

        const payload = buildPreLockPayload({ stageName: name, lockAtMs, nowMs: now });
        const outcome = await sendPushToPlayer(playerId, payload);
        sent += outcome.sent;
      }

      // Mark these reminders fired even if sent === 0 (no opted-in recipients
      // yet): the cutoff is fixed, so the same tick won't suddenly gain
      // recipients within its window in a way that warrants re-scanning.
      for (const r of due) fired.add(reminderFireKey(eventId, sectionId, r.fireAtMs));
      console.log(
        `[prelock] event ${eventId} section ${sectionId} (${name}): ${due.map((d) => d.label).join("+")} → ${sent} push(es)`,
      );
    }
  }
}
