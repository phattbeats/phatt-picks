/**
 * Multi-major workstream B (PHA-949) — pure logic for the "look back at your
 * picks every Major" history view and the archived-event freeze.
 *
 * Two concerns live here, both pure so the verify harness can import them
 * directly under `node --experimental-strip-types`:
 *
 * 1. FREEZE PREDICATES. Workstream A's registry tags each Major with a
 *    `status` (upcoming | live | archived). Once a Major's Grand Final
 *    resolves it flips to `archived` and must become read-only: no pick writes,
 *    no live crawl/sync drivers, and picks always revealed (the event is over —
 *    there are no secrets left to keep). These predicates are the single source
 *    of truth for "is this Major frozen", so the route guard, the live drivers,
 *    and the reveal gate all decide the same way.
 *
 *    Safety note: the live-driver and write guards key on `archived`
 *    SPECIFICALLY, not on `!== "live"`. The active event is always `live`, so
 *    these are exact no-ops today; keying on `archived` means a mis-edited
 *    registry can never accidentally freeze the live event (it fails open —
 *    the live Major keeps updating), honouring "don't break what we have now".
 *
 * 2. HISTORY AGGREGATION. `computeFinish` turns a scored, sorted field into a
 *    1-based placement, and `buildMajorsHistory` orders a player's played
 *    Majors newest-first for the /majors view. Kept pure (no prisma, no event
 *    config import beyond the `EventStatus` type) so the placement maths is
 *    testable without a database.
 */

import { type EventStatus } from "./events-core";

// ── Freeze predicates ──────────────────────────────────────────────────────

/** A Major whose Grand Final has resolved — frozen, read-only history. */
export function isEventArchived(status: EventStatus): boolean {
  return status === "archived";
}

// NOTE (PHA-954): the by-id convenience that used to live here keyed on the
// registry's RAW baseline `status` field, so the freeze only fired once a human
// flipped Cologne→archived — re-introducing the manual switch workstream C
// removed. The by-id resolvers now live in `event-freeze.ts`, which feeds these
// pure predicates the EFFECTIVE status (baseline advanced by the clock + the
// real Grand-Final-resolved signal). These predicates stay the single source of
// truth for the status→frozen MAPPING; event-freeze supplies the STATUS.

/** The one Major currently being played. */
export function isEventLive(status: EventStatus): boolean {
  return status === "live";
}

/**
 * May picks be WRITTEN for an event in this status? Archived Majors are frozen
 * (the route returns 409). Keyed on `archived` so the guard can never block the
 * live event even if the registry is mis-edited.
 */
export function isWriteFrozen(status: EventStatus): boolean {
  return isEventArchived(status);
}

/**
 * Should the live crawl/sync drivers (outcomes / layout / standings / team
 * stats / Steam mirror) run for an event in this status? They must NOT touch an
 * archived Major — its results are final and re-crawling would burn the budget
 * re-fetching a finished event. No-op for the live event today.
 */
export function shouldRunLiveDriver(status: EventStatus): boolean {
  return !isEventArchived(status);
}

/**
 * Are a player's picks ALWAYS revealed for an event in this status, regardless
 * of the per-stage lock gate? True for archived Majors: the event is over, so
 * every stage is public history. (Live/upcoming events still defer to the
 * normal reveal gate — picks stay secret until each stage locks.)
 */
export function isRevealForced(status: EventStatus): boolean {
  return isEventArchived(status);
}

// ── History aggregation ─────────────────────────────────────────────────────

/** One row of the "your Majors" history list. */
export interface MajorHistoryRow {
  eventId: number;
  slug: string;
  name: string;
  status: EventStatus;
  /** Inclusive UTC span the Major was played over (registry `dates`). */
  start: string;
  /** This player's total score for the Major. */
  score: number;
  /** 1-based placement among everyone who played it, or null if unscored. */
  finish: number | null;
  /** How many players took part. */
  fieldSize: number;
  /** How many pick slots the player filled (non-cleared). */
  pickCount: number;
}

/**
 * 1-based placement of `playerId` within a field already sorted best-first
 * (highest score → rank 1). Ties resolve to the FIRST occurrence, so callers
 * should pre-sort with their own deterministic tiebreak (e.g. score desc, then
 * name) exactly as the leaderboard does. Returns null if the player isn't in
 * the field.
 */
export function computeFinish(
  playerId: string,
  rankedPlayerIds: readonly string[],
): number | null {
  const idx = rankedPlayerIds.indexOf(playerId);
  return idx === -1 ? null : idx + 1;
}

/**
 * Order a player's played Majors for the history view: newest first by start
 * date (ISO-8601 strings sort lexicographically), with the slug as a stable
 * tiebreak so the order is deterministic when two Majors share a start. Pure —
 * the caller does the scoring/DB work and hands in finished rows.
 */
export function buildMajorsHistory(
  rows: readonly MajorHistoryRow[],
): MajorHistoryRow[] {
  return [...rows].sort(
    (a, b) => b.start.localeCompare(a.start) || a.slug.localeCompare(b.slug),
  );
}
