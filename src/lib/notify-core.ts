/**
 * notify-core — PURE pre-lock reminder logic. No prisma, no network, no env.
 *
 * Kept import-free (no runtime relative value imports) so the offline verify
 * harness can load it directly under `node --env-file`. The web-push transport
 * and DB live in notify.ts; the scheduler job composes the two.
 *
 * Spec (handoff §8.5): per stage, send a 24-hour and a 1-hour warning before
 * that stage's pick cutoff. Offsets are configurable, not hardcoded into logic.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Default pre-lock reminder offsets: 24 hours and 1 hour before cutoff. */
export const DEFAULT_REMINDER_OFFSETS_MS: readonly number[] = [DAY_MS, HOUR_MS];

/**
 * How long after a reminder's fire time it stays "due". A periodic scheduler
 * (e.g. every 5 min) catches the reminder once inside this window, so a single
 * tick miss doesn't drop it and we never re-fire indefinitely.
 */
export const DEFAULT_FIRE_WINDOW_MS = 15 * MINUTE_MS;

const TRUTHY_FLAGS: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSY_FLAGS: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

/**
 * Scheduler gate (PHA-996): default ON. The original opt-in env
 * (PRELOCK_REMINDERS_ENABLED, PHA-929) lived only on the container, so an
 * Unraid-template Force-Update recreated the container without it and the
 * reminders died silently. Defaulting on in code removes the env dependency:
 *  - PRELOCK_REMINDERS_DISABLED truthy  → off (the one supported opt-out)
 *  - PRELOCK_REMINDERS_ENABLED falsy    → off (explicit legacy opt-out honored)
 *  - anything else (incl. both unset)   → on
 * Pure: callers pass the raw env values; this module stays env-free.
 */
export function prelockSchedulerEnabled(
  enabledEnv: string | undefined,
  disabledEnv: string | undefined,
): boolean {
  if (TRUTHY_FLAGS.has((disabledEnv ?? "").trim().toLowerCase())) return false;
  if (FALSY_FLAGS.has((enabledEnv ?? "").trim().toLowerCase())) return false;
  return true;
}

export interface ReminderTime {
  /** Offset before lock this reminder represents (e.g. DAY_MS). */
  offsetMs: number;
  /** Absolute time the reminder should fire (lockAt - offset). */
  fireAtMs: number;
  /** Short label, e.g. "24h" / "1h". */
  label: string;
}

export interface PushAction {
  action: string;
  title: string;
}

export interface PreLockPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** Notification action buttons surfaced by the browser (desktop/Android). */
  actions?: PushAction[];
}

/**
 * Compact label for an offset: "24h", "1h", "30m", "2d".
 * Sub-day offsets read in hours/minutes; we only switch to days at >= 2 days,
 * so the spec's "24-hour" warning labels "24h" (not "1d").
 */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs >= 2 * DAY_MS && offsetMs % DAY_MS === 0) return `${offsetMs / DAY_MS}d`;
  if (offsetMs % HOUR_MS === 0) return `${offsetMs / HOUR_MS}h`;
  return `${Math.round(offsetMs / MINUTE_MS)}m`;
}

/** Human ETA for notification copy: "24 hours", "1 hour", "30 minutes". */
export function humanizeLockEta(ms: number): string {
  if (ms <= 0) return "now";
  if (ms % DAY_MS === 0 || ms >= DAY_MS) {
    const d = Math.round(ms / DAY_MS);
    if (d >= 1 && ms % DAY_MS === 0) return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (ms >= HOUR_MS) {
    const h = Math.round(ms / HOUR_MS);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const m = Math.max(1, Math.round(ms / MINUTE_MS));
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

/** All reminder fire times for a stage's lock time, sorted earliest first. */
export function computeReminderTimes(
  lockAtMs: number,
  offsetsMs: readonly number[] = DEFAULT_REMINDER_OFFSETS_MS,
): ReminderTime[] {
  return offsetsMs
    .map((offsetMs) => ({ offsetMs, fireAtMs: lockAtMs - offsetMs, label: offsetLabel(offsetMs) }))
    .sort((a, b) => a.fireAtMs - b.fireAtMs);
}

/**
 * Which reminders are due to fire right now: fired-time has passed, we're still
 * inside the catch-up window, and the stage hasn't locked yet.
 */
export function dueReminders(
  nowMs: number,
  lockAtMs: number,
  offsetsMs: readonly number[] = DEFAULT_REMINDER_OFFSETS_MS,
  windowMs: number = DEFAULT_FIRE_WINDOW_MS,
): ReminderTime[] {
  if (nowMs >= lockAtMs) return [];
  return computeReminderTimes(lockAtMs, offsetsMs).filter(
    (r) => nowMs >= r.fireAtMs && nowMs < r.fireAtMs + windowMs,
  );
}

/**
 * Stable dedup key for a single fired reminder. The scheduler runs every ~5 min
 * while `dueReminders` keeps a reminder "due" across the 15-min fire window —
 * roughly three ticks. Tracking fired keys (event+section+exact fire instant)
 * lets the job send each reminder once instead of on every tick inside the
 * window. fireAtMs (= lockAt - offset) uniquely identifies the 24h vs the 1h
 * reminder, so the two never collide.
 */
export function reminderFireKey(eventId: number, sectionId: number, fireAtMs: number): string {
  return `${eventId}:${sectionId}:${fireAtMs}`;
}

/** Build the push payload for a pre-lock reminder. */
export function buildPreLockPayload(args: {
  stageName: string;
  lockAtMs: number;
  nowMs: number;
  url?: string;
}): PreLockPayload {
  const { stageName, lockAtMs, nowMs, url = "/picks" } = args;
  const eta = humanizeLockEta(lockAtMs - nowMs);
  return {
    title: "HOTLINE",
    body: `${stageName} picks lock in ${eta} — set yours now.`,
    url,
    tag: `prelock-${stageName.toLowerCase().replace(/\s+/g, "-")}`,
    actions: [{ action: "picks", title: "Set picks" }],
  };
}

/** Build the push payload for a Bleachers reaction. */
export function buildReactionPayload(args: {
  stampGlyph: string;
  stampLabel: string;
  targetPlayerId: string;
}): PreLockPayload {
  return {
    title: "Someone's in your bleachers.",
    body: `A ${args.stampGlyph} ${args.stampLabel} just landed on one of your picks.`,
    url: "/picks",
    tag: `bleachers:${args.targetPlayerId}`,
    actions: [{ action: "view", title: "View picks" }],
  };
}

/** Build the push payload for a stage recap becoming available. */
export function buildRecapPayload(args: {
  stageName: string;
  sectionId: number;
}): PreLockPayload {
  return {
    title: "HOTLINE",
    body: `Your ${args.stageName} recap is ready — see how you stacked up.`,
    // Deep-link to the stage reveal page + re-open the cinematic deck (PHA-1245
    // follow-up). "/" only re-showed the popup on a device that hadn't dismissed
    // it; the reveal page always renders the recap.
    url: `/reveal/${args.sectionId}?wrapped=1`,
    tag: `recap:${args.sectionId}`,
    actions: [{ action: "view", title: "See recap" }],
  };
}

/** Build the push payload for a broadcast announcement. */
export function buildAnnouncementPayload(args: {
  title: string;
  body: string;
  href: string;
  id: string;
}): PreLockPayload {
  return {
    title: args.title,
    body: args.body,
    url: args.href,
    tag: `announce:${args.id}`,
    actions: [{ action: "view", title: "View" }],
  };
}

/**
 * Pure recipient predicate: only opted-in users (have a push subscription) who
 * have NOT already locked their picks for this stage get a reminder.
 */
export function isReminderRecipient(args: {
  hasSubscription: boolean;
  hasLockedStage: boolean;
}): boolean {
  return args.hasSubscription && !args.hasLockedStage;
}
