/**
 * Next.js instrumentation hook (PHA-929) — the in-process pre-lock reminder
 * scheduler.
 *
 * WHY in-process: the reminder job needs prisma + web-push against the live DB.
 * The production image is a Next standalone server — no tsx, no cron, traced
 * deps only — so an external `node scripts/send-prelock-reminders.ts` sidecar
 * can't run the TypeScript job, and the Dockerfile CMD only runs
 * `prisma db push && node server.js`. Next compiles instrumentation + its imports
 * into server.js, so registering a timer here is the one place the job reliably
 * runs in prod with zero extra infrastructure. This closes PHA-929: opt-in
 * worked, but nothing ever scheduled the send.
 *
 * GATING (PHA-996, was opt-in under PHA-929): ON by default. The opt-in env
 * lived only on the live container, so an Unraid-template Force-Update silently
 * dropped it and reminders died with no code change to catch it. The committed
 * lock schedule + reminderFireKey dedup already make an armed scheduler safe,
 * so the default flipped: set PRELOCK_REMINDERS_DISABLED=1 to opt out (an
 * explicit PRELOCK_REMINDERS_ENABLED=0 is honored too). No env needed to be on.
 */

import { prelockSchedulerEnabled } from "@/lib/notify-core";

const TICK_MS = 5 * 60 * 1000; // every 5 min — notify-core's 15-min fire window makes this idempotent
const FIRST_TICK_DELAY_MS = 30 * 1000; // let the server settle before the first scan

export async function register(): Promise<void> {
  // prisma + web-push only run in the Node.js server runtime (not edge/browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // PHA-982 — session-secret sanity at boot. A missing or placeholder
  // NEXTAUTH_SECRET silently invalidates EVERY existing phatt_session cookie
  // (the real mechanism behind "the container reset logged everyone out"): the
  // cookie verifies against the secret, so a new/blank secret = a mass logout.
  // Shout it here so a Force-Update that dropped the var from the Unraid
  // template is caught at boot, not one confused re-login at a time.
  {
    const { isPlaceholderSecret } = await import("@/lib/session-core");
    if (isPlaceholderSecret(process.env.NEXTAUTH_SECRET)) {
      console.error(
        "[session] WARNING: NEXTAUTH_SECRET is missing or a placeholder. Every " +
          "existing login cookie will fail to verify and all users will be logged " +
          "out. Set a fixed, high-entropy NEXTAUTH_SECRET in the Unraid template " +
          "(NOT ad-hoc on the container — Force-Update drops ad-hoc vars).",
      );
    } else {
      console.log("[session] NEXTAUTH_SECRET present — existing logins survive restart.");
    }
  }

  if (
    !prelockSchedulerEnabled(
      process.env.PRELOCK_REMINDERS_ENABLED,
      process.env.PRELOCK_REMINDERS_DISABLED,
    )
  ) {
    console.log(
      "[prelock] scheduler disabled by env opt-out — unset PRELOCK_REMINDERS_DISABLED to re-enable",
    );
    return;
  }

  // Import lazily so the heavy DB/web-push module graph loads only when armed.
  const { runPreLockReminders } = await import("@/lib/prelock-reminders");

  const tick = (): void => {
    runPreLockReminders().catch((err) => console.error("[prelock] tick failed:", err));
  };

  setTimeout(tick, FIRST_TICK_DELAY_MS);
  const timer = setInterval(tick, TICK_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[prelock] scheduler armed — every ${TICK_MS / 60_000} min`);
}
