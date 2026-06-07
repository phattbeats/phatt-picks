/**
 * Event-freeze resolution (PHA-954) — the chokepoint where workstream B's
 * read-only-history freeze meets workstream C's clock-derived lifecycle.
 *
 * THE PROBLEM THIS RECONCILES
 * B (PHA-949) gave the freeze pure predicates (majors-core: `isEventArchived` /
 * `isWriteFrozen` / `shouldRunLiveDriver` / `isRevealForced`) that each decide
 * off an event STATUS. C (PHA-950) gave the clock-derived `resolveEffectiveStatus`
 * (event-lifecycle-core), which advances a Major upcoming→live→archived on its
 * own. As merged the two DISAGREED: B fed its predicates the registry's
 * *baseline* `status` field — the hand-set flag C's whole promise was to remove.
 * So the combined system never self-archived: honour C (never flip the field)
 * and B's freeze never fired after the event ended (picks stayed writable, the
 * drivers kept crawling a finished Major, it never entered "your Majors");
 * honour B (flip the field by hand) and the manual switch C deleted was back.
 *
 * THE FIX (single clean chokepoint). This module is the ONE place that feeds the
 * freeze predicates their EFFECTIVE status: the baseline advanced by the wall
 * clock AND by the real Grand-Final-resolved signal — a StageOutcome row for the
 * event's Grand Final section. Every freeze decision (drivers, write guard,
 * forced reveal) derives from `resolveEffectiveStatusById` here, so each one
 * fires once a Major's GF resolves AND its 48h grace window elapses, with zero
 * human flips. The pure predicates stay the single source of truth for the
 * *mapping* status→frozen; this module only supplies the *status*.
 *
 * GRAND FINAL OVER THE CALENDAR. Archive is keyed on the real GF, not merely the
 * `dates.end` ceiling: a bracket that slips past its scheduled end therefore
 * never freezes the live drivers mid-event (it stays live until the GF actually
 * lands). `resolveEffectiveStatus` keeps `dates.end` only as a backstop, and the
 * registry sets that end generously past the likely GF so the drivers stay
 * un-frozen long enough to INGEST the GF outcome (see COLOGNE_2026.dates).
 *
 * POST-GF GRACE (PHA-954, Brandon's safety net). Even after the GF resolves the
 * event stays `live` for GRAND_FINAL_ARCHIVE_GRACE_MS (48h): the news/standings
 * drivers keep updating, a re-ingested/corrected outcome can settle, and players
 * can browse their pickems while the result is fresh — only then does it become
 * read-only "old Major" history. The GF's `resolvedAt` (not a boolean) is what
 * lets this module measure that window.
 *
 * Behind current behavior: Cologne is effective-`live` until its GF resolves /
 * its (generous) `dates.end`, so every function here is a no-op today.
 *
 * I/O module (imports prisma) — deliberately NOT imported by the verify harness.
 * The pure pieces it composes (`resolveEffectiveStatus`, `grandFinalSectionId`,
 * the majors-core predicates) are each proven directly under strip-types; this
 * thin layer only joins them to the database.
 */

import { prisma } from "./db";
import { getEventConfig, grandFinalSectionId, type EventConfig } from "./events-core";
import { resolveEffectiveStatus } from "./event-lifecycle-core";
import type { EventStatus } from "./events-core";
import {
  isEventArchived,
  isWriteFrozen,
  isRevealForced,
} from "./majors-core";

/**
 * WHEN did the event's Grand Final resolve? Returns the epoch-ms `resolvedAt` of
 * the event's Grand Final section (the terminal playoff round, located
 * structurally via `grandFinalSectionId`) — the earliest if it somehow has more
 * than one row — or null while it hasn't resolved (or the format has no Grand
 * Final). This timestamp, NOT a mere boolean, is what feeds the live→archived
 * transition: the freeze fires the post-GF grace window AFTER the real final,
 * not the moment it lands and not the `dates.end` ceiling. Cheap indexed lookup
 * on (eventId, sectionId).
 */
export async function grandFinalResolvedAtMs(
  event: EventConfig,
): Promise<number | null> {
  const gfSection = grandFinalSectionId(event);
  if (gfSection === null) return null;
  const row = await prisma.stageOutcome.findFirst({
    where: { eventId: event.eventId, sectionId: gfSection },
    orderBy: { resolvedAt: "asc" },
    select: { resolvedAt: true },
  });
  return row ? row.resolvedAt.getTime() : null;
}

/**
 * The EFFECTIVE status of the event with this id RIGHT NOW — the registry
 * baseline advanced by the wall clock and the Grand-Final-resolved signal (which
 * only archives 48h after the final, per the post-GF grace window). This is THE
 * reconciliation chokepoint: every freeze decision below derives from it. null
 * when the id isn't registered, so callers fail open (an unknown event is never
 * treated as frozen). `nowMs` is injectable so a render can share its request
 * clock.
 */
export async function resolveEffectiveStatusById(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<EventStatus | null> {
  const cfg = getEventConfig(eventId);
  if (!cfg) return null;
  const resolvedAtMs = await grandFinalResolvedAtMs(cfg);
  return resolveEffectiveStatus(cfg, nowMs, {
    grandFinalResolvedAtMs: resolvedAtMs,
  });
}

/**
 * Is this event frozen (effectively archived) right now? The live drivers
 * (outcomes / layout / standings / team stats / Steam mirror) call this to stop
 * crawling a finished Major. By EFFECTIVE status, not the raw registry flag, so
 * the freeze fires on the real Grand Final with no human flip. Unregistered ids
 * fail open (not frozen) — the guard can only ever stop a driver for an event
 * the clock/GF says is over. No-op for Cologne today (effective-live).
 */
export async function isEventFrozenById(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const status = await resolveEffectiveStatusById(eventId, nowMs);
  return status === null ? false : isEventArchived(status);
}

/**
 * May picks be WRITTEN for this event right now? The picks route's up-front
 * guard calls this; an effectively-archived Major returns 409. By effective
 * status (clock + GF), so the write freeze fires on the real Grand Final with no
 * human flip. Unregistered ids fail open (writable).
 */
export async function isWriteFrozenById(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const status = await resolveEffectiveStatusById(eventId, nowMs);
  return status === null ? false : isWriteFrozen(status);
}

/**
 * Are this event's picks ALWAYS revealed right now — i.e. is it effectively
 * archived, read-only history where every stage is public regardless of the
 * per-stage lock gate? The compare and player-profile reveal pages call this and
 * pass the result as reveal-core's `eventArchived` signal, so a finished Major
 * shows every pick even for a stage that never locked on schedule. By effective
 * status. No-op today (the active event is effective-live, so this is false and
 * the per-stage lock gate alone decides reveal, exactly as before).
 */
export async function isRevealForcedById(
  eventId: number,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const status = await resolveEffectiveStatusById(eventId, nowMs);
  return status === null ? false : isRevealForced(status);
}
