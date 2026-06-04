/**
 * send-prelock-reminders — CLI entry for the pre-lock reminder job (PHA-929).
 *
 * The job itself lives in src/lib/prelock-reminders.ts so the in-process
 * scheduler (src/instrumentation.ts) and this CLI share ONE code path. This
 * wrapper exists for manual / one-off runs against the app runtime:
 *
 *   node scripts/send-prelock-reminders.ts
 *
 * Stage cutoffs now come from the committed COLOGNE_LOCK_SCHEDULE (single source
 * of truth) — no STAGE_LOCKS_JSON needed; it survives only as an optional
 * override for future majors. Uses the `@/` alias + prisma + web-push, so it
 * must run in the app runtime, not bare node.
 */

import { runPreLockReminders } from "@/lib/prelock-reminders";

runPreLockReminders()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[prelock] failed:", err);
    process.exit(1);
  });
