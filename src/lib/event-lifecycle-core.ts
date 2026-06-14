/**
 * Event lifecycle — derive an event's *effective* status from the clock so the
 * site runs itself across Majors (PHA-950, multi-major workstream C).
 *
 * THE PROBLEM THIS SOLVES
 * Workstream A (PHA-948) gave every Major a registry entry with a hand-set
 * `status: "upcoming" | "live" | "archived"`. That makes a human flip a switch:
 * someone has to remember to mark Cologne `archived` the morning after the Grand
 * Final and the next Major `live` the week its picks open. This module removes
 * the human from that loop. Given a registry entry's *baseline* status (the
 * staged intent) plus the wall clock and a "did the Grand Final resolve" signal,
 * it derives the *effective* status the rest of the app should act on — so a
 * Major staged as `upcoming` goes `live` on schedule and a `live` Major goes
 * `archived` when its Grand Final lands, with nobody touching the registry.
 *
 * THE LIFECYCLE IS MONOTONIC. upcoming → live → archived, forward only. The
 * derived status can advance the baseline but never walk it back: an `archived`
 * baseline is terminal (a retired Major is never resurrected by the clock), and
 * a `live` baseline is never shown as `upcoming`. The baseline is the floor; the
 * clock can only push an event further along its life, never rewind it. This is
 * the invariant `resolveEffectiveStatus` enforces and `verify-event-lifecycle`
 * proves.
 *
 * WHY A SEPARATE LEAF MODULE (and not part of events-core). This is pure policy
 * over a tiny structural shape — it reads only `status`, `dates` and
 * `lockSchedule`, never the registry's heavy pickid-keyed resources. Keeping it
 * standalone (it imports NOTHING from events-core) means: the verify harness can
 * import it under `node --experimental-strip-types` with no fixtures, and the
 * registry can depend on *it* at cutover (events-core → event-lifecycle-core)
 * with the arrow pointing one way, keeping the graph acyclic. The `EventConfig`
 * the registry defines structurally satisfies `LifecycleEvent`, so no import is
 * needed in either direction until the wiring step.
 *
 * Pure module — no `@/` alias, no prisma, no fetch, no `Date.now()` (every entry
 * point takes `nowMs` so behaviour is a pure function of its inputs and the
 * verify script can pin the clock).
 */

/** The lifecycle phases of a Major. Ordered: upcoming < live < archived. */
export type EventStatus = "upcoming" | "live" | "archived";

/** Position of each status on the one-way lifecycle line (for the clamp). */
const PHASE_RANK: Readonly<Record<EventStatus, number>> = {
  upcoming: 0,
  live: 1,
  archived: 2,
};

/**
 * The minimal shape this module needs from a registry entry. Declared
 * structurally (not imported from events-core) so this stays a zero-dependency
 * leaf; the registry's richer `EventConfig` satisfies it. `lockSchedule` is the
 * sectionId -> ISO-8601 lock-instant map (lock-schedule-core's `LockSchedule`).
 */
export interface LifecycleEvent {
  /** Valve event id — only used to label/identify in selection helpers. */
  eventId: number;
  /** The hand-set baseline / staged intent from the registry. */
  status: EventStatus;
  /** Inclusive UTC span over which the whole event is played. */
  dates: { start: string; end: string };
  /** sectionId -> ISO-8601 UTC lock instant (a stage's first match). */
  lockSchedule: Readonly<Record<number, string>>;
}

/**
 * How far ahead of an event's FIRST lock it flips from `upcoming` to `live` —
 * the staging lead. An event goes live this long before its earliest stage locks
 * so the picker, countdown and lineup are open while picks are still being made,
 * not the instant the first match starts. Seven days mirrors how Cologne's
 * picker opened roughly a week before Stage I. Override per call where a Major
 * wants a different runway; this is only the default.
 */
export const DEFAULT_GO_LIVE_LEAD_MS = 7 * 24 * 60 * 60_000;

/**
 * How long a Major lingers as `live` AFTER its Grand Final resolves before it
 * archives into read-only "old Major" history — the post-final grace window
 * (PHA-954, Brandon's safety net). The instant the trophy lifts is NOT the
 * instant the site should go cold: for these 48 hours the news/standings drivers
 * keep updating, a late-corrected or re-ingested outcome can settle, and players
 * can still browse their pickems while the result is fresh. Only once the grace
 * elapses does the freeze fire (writes 409, drivers stop, event enters "your
 * Majors"). Override per call via `LifecycleOptions.postGrandFinalGraceMs`.
 */
export const GRAND_FINAL_ARCHIVE_GRACE_MS = 48 * 60 * 60_000;

/**
 * How close to its go-live an `upcoming` Major must be before it becomes the
 * event the SITE SHOWS — the off-season anticipation window (PHA-1048). It does
 * NOT change when an event goes live (that's `goLiveMs`); it only governs which
 * event `selectCurrentEvent` surfaces while none is live. The motivation: the
 * next Major is pre-seeded in the registry the moment its dates are known —
 * often ~5 months out (Singapore was seeded in June for a late-November start).
 * Without this gate, the instant the prior Major archives the whole site would
 * flip its identity to that barely-configured future event (empty sources/
 * schedule, name + countdown only) rather than letting players bask in the
 * results they just played for. So a far-off upcoming event is held back: until
 * it's within this window of go-live, the most-recently-archived Major stays the
 * face of the site, then the next one takes over ~6 weeks out. Tuned to ~45 days
 * so the handover lands around when HLTV/Valve publish the stage pages and the
 * field anyway. A registry with ONLY a far-future upcoming event (a brand-new
 * site, nothing archived yet) still shows it — the gate only defers an upcoming
 * event when there's an archived one to fall back to.
 */
export const ANTICIPATION_LEAD_MS = 45 * 24 * 60 * 60_000;

/** Tunables for the derivation; all optional with documented defaults. */
export interface LifecycleOptions {
  /**
   * Epoch-ms instant the event's Grand Final RESOLVED (a winner became known —
   * the GF StageOutcome's `resolvedAt`), or null/undefined while it hasn't.
   * Injected by the caller that has outcome data — this module never fetches.
   * The event archives `postGrandFinalGraceMs` AFTER this instant, not the
   * moment it resolves: that grace window is the precise "live → (48h later)
   * archived" trigger. Defaults to null (fall back to the `dates.end` ceiling).
   */
  grandFinalResolvedAtMs?: number | null;
  /**
   * The post-Grand-Final grace before archiving; see
   * GRAND_FINAL_ARCHIVE_GRACE_MS (the 48h default). Pass 0 to archive the instant
   * the GF resolves (the pre-grace behaviour).
   */
  postGrandFinalGraceMs?: number;
  /** Staging lead before first lock; see DEFAULT_GO_LIVE_LEAD_MS. */
  goLiveLeadMs?: number;
}

/**
 * Earliest lock instant across an event's stages, in epoch ms — the moment the
 * FIRST stage's picks lock. This is the "first lock approaches" anchor for the
 * upcoming → live transition. Ignores unparseable/empty entries; returns null
 * when the schedule has no usable instant (e.g. a Major staged before its lock
 * times are published — it then falls back to `dates.start`).
 */
export function firstLockMs(event: LifecycleEvent): number | null {
  let earliest: number | null = null;
  for (const iso of Object.values(event.lockSchedule)) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    if (earliest === null || t < earliest) earliest = t;
  }
  return earliest;
}

/**
 * The instant an event becomes the live event: the earlier of its declared
 * `dates.start` and `firstLock − goLiveLead`. Taking the earlier of the two
 * means an event with an early overall start still opens on that start, while
 * one whose start is pinned to match-day opens a runway before its first lock.
 * Falls back to `dates.start` alone when the lock schedule isn't published yet.
 */
export function goLiveMs(
  event: LifecycleEvent,
  goLiveLeadMs: number = DEFAULT_GO_LIVE_LEAD_MS,
): number {
  const start = Date.parse(event.dates.start);
  const lock = firstLockMs(event);
  const fromLock = lock === null ? null : lock - goLiveLeadMs;
  if (Number.isNaN(start)) return fromLock ?? Number.POSITIVE_INFINITY;
  if (fromLock === null) return start;
  return Math.min(start, fromLock);
}

/**
 * Derive the status the app should act on, from the baseline + the clock.
 *
 * Clock-only verdict:
 *   • `archived`  — the Grand Final resolved AND its grace window has elapsed,
 *                   OR now is past `dates.end`.
 *   • `live`      — now is at/after the go-live instant and the event has not
 *                   concluded (this includes the post-GF grace window, when the
 *                   final is decided but the site stays warm for 48h).
 *   • `upcoming`  — before the go-live instant.
 *
 * Then clamp forward to the baseline so the lifecycle never runs backward
 * (`max(baseline, clockVerdict)` on the phase line): an `archived` baseline
 * stays archived; a `live` baseline is never demoted to `upcoming`. Pure in
 * `nowMs`.
 */
export function resolveEffectiveStatus(
  event: LifecycleEvent,
  nowMs: number,
  opts: LifecycleOptions = {},
): EventStatus {
  const {
    grandFinalResolvedAtMs = null,
    postGrandFinalGraceMs = GRAND_FINAL_ARCHIVE_GRACE_MS,
    goLiveLeadMs = DEFAULT_GO_LIVE_LEAD_MS,
  } = opts;

  // The Grand Final concludes the event only AFTER its grace window: the trophy
  // lifts, the site stays warm 48h (news settles, pickems browsable), THEN it
  // freezes. `dates.end` remains a hard backstop ceiling (no grace — it is set
  // generously past the GF precisely as the failsafe for a never-ingested GF).
  const end = Date.parse(event.dates.end);
  const archivedByGrandFinal =
    grandFinalResolvedAtMs != null &&
    nowMs >= grandFinalResolvedAtMs + postGrandFinalGraceMs;
  const archivedByCalendar = !Number.isNaN(end) && nowMs > end;
  const concluded = archivedByGrandFinal || archivedByCalendar;

  let clockVerdict: EventStatus;
  if (concluded) {
    clockVerdict = "archived";
  } else if (nowMs >= goLiveMs(event, goLiveLeadMs)) {
    clockVerdict = "live";
  } else {
    clockVerdict = "upcoming";
  }

  // Monotonic clamp: the clock can advance the baseline, never rewind it.
  return PHASE_RANK[clockVerdict] >= PHASE_RANK[event.status]
    ? clockVerdict
    : event.status;
}

/** True when the event is effectively live right now. */
export function isEffectivelyLive(
  event: LifecycleEvent,
  nowMs: number,
  opts: LifecycleOptions = {},
): boolean {
  return resolveEffectiveStatus(event, nowMs, opts) === "live";
}

/**
 * The events that are effectively live at `nowMs` — what the on-read drivers,
 * watchers and reminders should iterate over instead of a hardcoded constant.
 * Normally length 1; supports 0 (between Majors) and, briefly, >1 (one Major
 * archiving as the next goes live). `optsFor` lets the caller supply the
 * per-event Grand-Final-resolved signal it looked up from outcome data.
 */
export function selectLiveEvents(
  events: readonly LifecycleEvent[],
  nowMs: number,
  optsFor: (e: LifecycleEvent) => LifecycleOptions = () => ({}),
): LifecycleEvent[] {
  return events.filter((e) => isEffectivelyLive(e, nowMs, optsFor(e)));
}

/**
 * The single event the picker / pages should show — robust across the gaps that
 * a self-sustaining, multi-Major site has. Preference order:
 *   1. an effectively-live event (the soonest go-live among them, if several);
 *   2. else the soonest-STARTING upcoming event (by `dates.start`, PHA-1046)
 *      that is WITHIN its anticipation window (`ANTICIPATION_LEAD_MS` of go-live)
 *      — so we count down to the Major that genuinely plays next once it's near,
 *      but a Major seeded months out doesn't yet hijack the site (PHA-1048);
 *   3. else the most-recently-concluded ARCHIVED event (so the off-season keeps
 *      showing the last Major — its results stay the face of the site — rather
 *      than a half-built future event or a blank page);
 *   4. else the soonest-STARTING upcoming event regardless of window — the
 *      brand-new-site fallback so a registry holding ONLY a far-future event
 *      still shows it;
 *   5. else null (empty registry).
 * Deterministic: ties break on earlier start → earlier go-live / later end /
 * lower eventId.
 */
export function selectCurrentEvent(
  events: readonly LifecycleEvent[],
  nowMs: number,
  optsFor: (e: LifecycleEvent) => LifecycleOptions = () => ({}),
): LifecycleEvent | null {
  const tagged = events.map((e) => ({
    e,
    status: resolveEffectiveStatus(e, nowMs, optsFor(e)),
    goLive: goLiveMs(e, optsFor(e).goLiveLeadMs ?? DEFAULT_GO_LIVE_LEAD_MS),
    start: Date.parse(e.dates.start),
    end: Date.parse(e.dates.end),
  }));

  // A live event is ranked by when it went live — soonest-live first (a tie only
  // arises in the brief overlap as one Major archives while the next opens).
  const live = tagged
    .filter((t) => t.status === "live")
    .sort((a, b) => a.goLive - b.goLive || a.e.eventId - b.e.eventId);
  if (live.length) return live[0].e;

  // Upcoming events. PHA-1046: rank by GENUINE `dates.start`, NOT lead-adjusted
  // go-live. `goLiveMs` is `min(start, firstLock − lead)`, so go-live is pulled up
  // to the staging lead (7d) ahead of an event's start; ranking on go-live lets a
  // LATER-starting Major outrank a genuinely-sooner one when its match-day lock
  // pulls its go-live earlier (A starts Jun 1, no lock → go-live Jun 1; B starts
  // Jun 5, match-day lock → go-live May 29; go-live ranks B first though A plays
  // first). (The audit's `min(goLive, dates.start)` is a no-op — since go-live ≤
  // start, that min always equals go-live; raw start is the real fix.) Unparseable
  // starts sort last so a misconfig never hijacks the countdown; go-live then
  // eventId break ties.
  //
  // PHA-1048: split on the anticipation window so a Major seeded months out (the
  // day its dates were known) does not preempt a just-finished one — it becomes
  // the face only once within ANTICIPATION_LEAD_MS of its go-live.
  const startKey = (t: { start: number }) =>
    Number.isNaN(t.start) ? Number.POSITIVE_INFINITY : t.start;
  const upcoming = tagged
    .filter((t) => t.status === "upcoming")
    .sort(
      (a, b) =>
        startKey(a) - startKey(b) || a.goLive - b.goLive || a.e.eventId - b.e.eventId,
    );
  const anticipated = upcoming.filter((t) => nowMs >= t.goLive - ANTICIPATION_LEAD_MS);
  if (anticipated.length) return anticipated[0].e;

  const archived = tagged
    .filter((t) => t.status === "archived")
    .sort((a, b) => {
      const ae = Number.isNaN(a.end) ? -Infinity : a.end;
      const be = Number.isNaN(b.end) ? -Infinity : b.end;
      return be - ae || a.e.eventId - b.e.eventId;
    });
  if (archived.length) return archived[0].e;

  // Nothing live, nothing archived to hold on, and the only events are upcoming
  // but still outside their anticipation window — show the soonest anyway, so a
  // first-launch registry counts down rather than rendering blank.
  if (upcoming.length) return upcoming[0].e;

  return null;
}
