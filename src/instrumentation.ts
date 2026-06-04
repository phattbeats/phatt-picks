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
 * GATING (owner decision): OFF unless PRELOCK_REMINDERS_ENABLED is truthy.
 * Standing up live reminders is Brandon's call, so merging this code is inert by
 * default — register() logs and returns without arming a timer. Flip
 * PRELOCK_REMINDERS_ENABLED=1 in the deploy env (docker-compose) + Force Update
 * to turn reminders on.
 */

const TICK_MS = 5 * 60 * 1000; // every 5 min — notify-core's 15-min fire window makes this idempotent
const FIRST_TICK_DELAY_MS = 30 * 1000; // let the server settle before the first scan

function schedulerEnabled(): boolean {
  const v = (process.env.PRELOCK_REMINDERS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function register(): Promise<void> {
  // prisma + web-push only run in the Node.js server runtime (not edge/browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!schedulerEnabled()) {
    console.log("[prelock] scheduler disabled — set PRELOCK_REMINDERS_ENABLED=1 to enable");
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
