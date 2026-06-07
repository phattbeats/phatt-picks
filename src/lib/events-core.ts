/**
 * Event registry — the single committed source for "which Major are we running
 * and what is its per-event config" (PHA-948, multi-major workstream A).
 *
 * THE PROBLEM THIS REPLACES
 * Every page and API route declared its own `const EVENT_ID = 26`, and the
 * per-major config (lock schedule, match windows, the HLTV standings sources,
 * the layout/logos fixtures, the pickid-keyed team maps) lived as `COLOGNE_*`
 * singletons scattered across ~10 modules. Standing up the next Major meant
 * hunting every one of those down. This registry centralises the *identity* of
 * the active event and *indexes* its config so adding a major is a registry
 * entry plus the per-fixture swaps the re-point runbook already describes
 * (docs/NEXT-MAJOR.md), and going live is flipping one `status` field.
 *
 * SEQUENCING (PHA-948). This is the BACKBONE that lands *behind current
 * behavior*: `resolveActiveEvent()` returns Cologne (eventId 26, the sole
 * `live` entry), so every consumer that reads `ACTIVE_EVENT_ID` gets exactly
 * the 26 it hardcoded before — nothing about the live event changes. The full
 * *cutover* (inverting the domain modules' default params so they read the
 * active event's `lockSchedule` / `matchWindows` instead of their own
 * `COLOGNE_*` constant) is deliberately deferred to the follow-up workstream so
 * we don't destabilise Cologne mid-event. Until then this registry *references*
 * those committed constants rather than owning them; see the field docs below.
 *
 * Pure module — no `@/` alias, no prisma, no fetch, no JSON import — so the
 * verify harness (scripts/verify-events.ts) can import it directly under
 * `node --experimental-strip-types`. It imports only the pure leaf
 * `./lock-schedule-core`; the dependency is one-directional (that module never
 * imports this one) to keep the graph acyclic.
 */

import {
  COLOGNE_LOCK_SCHEDULE,
  COLOGNE_MATCH_WINDOWS,
  COLOGNE_SECTION_NAMES,
  lockTimeForSection,
  bracketRevealTime,
  type LockSchedule,
  type MatchWindow,
} from "./lock-schedule-core";
import {
  isEffectivelyLive,
  selectCurrentEvent,
} from "./event-lifecycle-core";

/** Lifecycle of a Major in the registry. Exactly one entry is `live`. */
export type EventStatus = "upcoming" | "live" | "archived";

/** Which HLTV event page carries the live Swiss table for a section. */
export interface SectionSource {
  url: string;
  label: string;
}

/**
 * Everything that varies per Major. The small, pure, section-keyed config lives
 * here directly (or is referenced from its committed home); the large,
 * pickid-keyed resources (the layout fixture, logos manifest, region/stats/
 * source maps) are recorded by *identity* under `fixtures` / `teamMaps` because
 * they're swapped in their own files per the re-point runbook (NEXT-MAJOR.md),
 * not inlined into a registry entry.
 */
export interface EventConfig {
  /** Valve tournament/event id — matches the committed layout's `result.event`. */
  eventId: number;
  /** Stable url-safe handle, e.g. "iem-cologne-2026". */
  slug: string;
  /** Human display name (matches the layout's `result.name`). */
  name: string;
  status: EventStatus;
  /** Inclusive UTC span over which the whole event is played. */
  dates: { start: string; end: string };

  /** sectionId -> display name ("Stage I", "Quarterfinals", ...). */
  sectionNames: Readonly<Record<number, string>>;
  /** sectionId -> ISO-8601 UTC lock instant (the stage's first match). */
  lockSchedule: LockSchedule;
  /** sectionId -> the date span the stage is played. */
  matchWindows: Readonly<Record<number, MatchWindow>>;
  /** sectionId -> live HLTV event page for the Swiss standings/bracket crawl. */
  sectionSources: Readonly<Record<number, SectionSource>>;

  /**
   * Pickid-keyed resources that swap per Major in their own files. Recorded by
   * identity so the registry indexes the binding and the cutover workstream +
   * the re-point runbook know exactly which files back this event. The data
   * itself stays in those modules (large + pickid-keyed). See NEXT-MAJOR.md.
   */
  fixtures: {
    /** Layout fixture basename under src/fixtures (e.g. "cologne-layout"). */
    layout: string;
    /** Logos manifest basename under src/fixtures (e.g. "cologne-logos"). */
    logos: string;
  };
  teamMaps: {
    /** Module that owns pickid -> region (src/lib/<slug>.ts). */
    regions: string;
    /** Module that owns pickid -> frozen HLTV stats snapshot. */
    stats: string;
    /** Module that owns pickid -> HLTV profile source metadata. */
    sources: string;
  };
}

/**
 * IEM Cologne 2026 — the live Major. Section ids 105/106/107 (Swiss Stages
 * I/II/III) + 108/109/110 (QF/SF/GF), per the committed cologne-layout fixture.
 *
 * `lockSchedule` / `matchWindows` / `sectionNames` reference the committed
 * constants in lock-schedule-core (their canonical home until the cutover
 * inverts the dependency). `sectionSources` lives here — this registry is its
 * home (swiss-results.ts imports `SECTION_SOURCES` from this module). Only
 * Swiss stages with a live HLTV event are mapped; Stage III + playoffs map in
 * as HLTV publishes them (the picker/lineup still render without a source).
 */
const COLOGNE_2026: EventConfig = {
  eventId: 26,
  slug: "iem-cologne-2026",
  name: "IEM Cologne 2026 CS2 Major Championship",
  status: "live",
  // `end` is the calendar BACKSTOP for the archive transition, not the real
  // trigger — that is the Grand Final StageOutcome (PHA-954, via
  // `grandFinalResolved`). It's set generously past the likely GF (~Jun 21) on
  // purpose: a GF that finishes late on the 21st lands its outcome row ~1h+
  // later (possibly Jun 22 UTC), and the live drivers must stay un-frozen long
  // enough to INGEST that GF result. A tight Jun-21 ceiling could freeze the
  // layout/outcome crawl right as the deciding game resolves; the buffer lets
  // the GF signal — not the clock — fire the archive. See PHA-954.
  dates: { start: "2026-06-02T00:00:00Z", end: "2026-06-24T23:59:59Z" },
  sectionNames: COLOGNE_SECTION_NAMES,
  lockSchedule: COLOGNE_LOCK_SCHEDULE,
  matchWindows: COLOGNE_MATCH_WINDOWS,
  sectionSources: {
    105: {
      url: "https://www.hltv.org/events/9028/iem-cologne-major-2026-stage-1",
      label: "HLTV",
    },
    106: {
      url: "https://www.hltv.org/events/9029/iem-cologne-major-2026-stage-2",
      label: "HLTV",
    },
  },
  fixtures: { layout: "cologne-layout", logos: "cologne-logos" },
  teamMaps: {
    regions: "regions-core",
    stats: "team-stats-core",
    sources: "team-stats-sources",
  },
};

/**
 * The committed event registry, keyed by Valve event id. Adding a Major is a
 * new entry here (plus the per-fixture swaps in NEXT-MAJOR.md); going live is
 * flipping its `status` to "live" and the previous event's to "archived".
 */
export const EVENTS: Readonly<Record<number, EventConfig>> = {
  [COLOGNE_2026.eventId]: COLOGNE_2026,
};

/** Look up an event's config by Valve event id; null when not registered. */
export function getEventConfig(id: number): EventConfig | null {
  return EVENTS[id] ?? null;
}

/**
 * The events that are effectively LIVE at `nowMs` — derived from the clock, not
 * a hand-set flag (PHA-950, workstream C). A registry entry's `status` is the
 * staged baseline; `event-lifecycle-core` advances it forward as time passes
 * (an `upcoming` Major flips to live on its staging lead, a `live` one to
 * archived at its `dates.end` ceiling — see `resolveEffectiveStatus`). This is
 * what the on-read drivers / watchers / reminders iterate instead of a single
 * hardcoded id, so the next Major's reminders fire on schedule with nobody
 * editing the registry. Today this is exactly `[Cologne]` — behind current
 * behavior. Normally length 1; 0 between Majors, briefly >1 across an overlap.
 */
export function liveEvents(nowMs: number = Date.now()): EventConfig[] {
  return Object.values(EVENTS).filter((e) => isEffectivelyLive(e, nowMs));
}

/**
 * The single event the picker / pages should serve right now — robust across
 * the gaps a self-sustaining multi-Major site has (live › soonest-upcoming ›
 * most-recently-archived, so the off-season still shows the last Major rather
 * than a blank site). Throws only if the registry is empty, which is a build
 * error, never a runtime state. Clock-derived; Cologne today.
 */
export function currentEvent(nowMs: number = Date.now()): EventConfig {
  const e = selectCurrentEvent(Object.values(EVENTS), nowMs) as EventConfig | null;
  if (!e) {
    throw new Error("event registry is empty — no event to serve");
  }
  return e;
}

/** The active event's Valve id at `nowMs`. */
export function currentEventId(nowMs: number = Date.now()): number {
  return currentEvent(nowMs).eventId;
}

/**
 * The event currently being run. Now CLOCK-DERIVED (PHA-950): it returns the
 * event whose *effective* status — baseline `status` advanced by the wall clock
 * — makes it the one to serve, so the registry transitions upcoming→live→
 * archived across Majors with no human flipping the `status` field. Today that
 * is Cologne (effective `live`), so every existing caller is unchanged. Kept
 * with a no-arg signature for the PHA-948 call sites; takes `nowMs` for tests.
 */
export function resolveActiveEvent(nowMs: number = Date.now()): EventConfig {
  return currentEvent(nowMs);
}

/**
 * Validate that an event's per-section reveal config is internally consistent —
 * the guard that keeps the 24h bracket/standings reveal (PHA-943) working for
 * FUTURE majors, not just Cologne. Returns human-readable problems (empty =
 * healthy); verify-events.ts asserts it's empty for EVERY registered event
 * (live, upcoming, or archived), so a half-filled config for the next Major
 * fails loudly at CI time instead of silently never revealing — the exact class
 * of slip that left Stage III's window unset.
 *
 * Invariants, all section-id keyed:
 *   A. every crawled stage (`sectionSources`) has a `lockSchedule` entry — else
 *      its data is fetched but the bracket never reveals pre-lock and the stage
 *      never locks by time;
 *   B. every crawled stage has a `matchWindows` entry — else the hourly crawl
 *      never closes once the stage is decided;
 *   C. every dated stage (`matchWindows`) has a `lockSchedule` entry — an
 *      orphaned window with no lock is a config slip;
 *   D. every `lockSchedule` value is a valid ISO whose reveal instant
 *      (`lockAt − 24h`) resolves strictly before the lock.
 *
 * Note these flow only FROM sources→lock/window and window→lock: a Swiss stage
 * with a lock+window but no source yet (Stage III today, source unpublished) and
 * the playoff sections (no lock/window/source at all) are both legitimately
 * silent and never flagged. Pure; no I/O.
 */
export function validateEventRevealConfig(event: EventConfig): string[] {
  const problems: string[] = [];
  const tag = `event ${event.eventId} (${event.slug})`;
  const lockKeys = new Set(Object.keys(event.lockSchedule).map(Number));
  const windowKeys = new Set(Object.keys(event.matchWindows).map(Number));

  for (const key of Object.keys(event.sectionSources).map(Number)) {
    if (!lockKeys.has(key))
      problems.push(`${tag}: section ${key} has a Swiss source but no lockSchedule entry (bracket would never reveal / lock)`);
    if (!windowKeys.has(key))
      problems.push(`${tag}: section ${key} has a Swiss source but no matchWindows entry (crawl would never close)`);
  }
  for (const key of windowKeys) {
    if (!lockKeys.has(key))
      problems.push(`${tag}: section ${key} has a matchWindows entry but no lockSchedule entry (orphaned window)`);
  }
  for (const key of lockKeys) {
    const iso = lockTimeForSection(key, event.lockSchedule);
    if (iso === null) {
      problems.push(`${tag}: section ${key} lockSchedule value is not a valid ISO instant`);
      continue;
    }
    const reveal = bracketRevealTime(key, event.lockSchedule);
    if (reveal === null || !(Date.parse(reveal) < Date.parse(iso)))
      problems.push(`${tag}: section ${key} reveal time does not resolve strictly before its lock`);
  }
  return problems;
}

/**
 * The section id of a Major's Grand Final — the terminal playoff round whose
 * resolution ends the event (PHA-954). Derived STRUCTURALLY from `sectionNames`
 * (the section whose display name reads "Grand Final"), so it's correct for any
 * registered Major with no hand-maintained id to keep in sync. This is the
 * section the freeze watches: a StageOutcome row for it means the Grand Final
 * resolved, which fires the live→archived transition on the REAL final rather
 * than the `dates.end` calendar ceiling.
 *
 * Returns null when the event declares no "Grand Final" section (a format
 * without one, or one not yet named); callers then fall back to the `dates.end`
 * ceiling for the archive transition. Pure; no I/O.
 */
export function grandFinalSectionId(event: EventConfig): number | null {
  for (const [key, name] of Object.entries(event.sectionNames)) {
    if (/grand\s*final/i.test(name)) return Number(key);
  }
  return null;
}

/**
 * Convenience constant for the ~15 pages/routes that previously hardcoded
 * `const EVENT_ID = 26`. Resolved once at module load from the clock-derived
 * active event, so every consumer shares one source of truth — and a deploy/
 * restart inside the next Major's window auto-serves it (the boot-time half of
 * the self-sustaining lifecycle; in-process drivers re-evaluate via the
 * `liveEvents(now)` / `currentEvent(now)` accessors above).
 */
export const ACTIVE_EVENT_ID: number = currentEvent().eventId;

/**
 * The active event's HLTV Swiss sources, keyed by section id. swiss-results.ts
 * imports this so the standings/bracket crawl reads the registry rather than a
 * private duplicate. The clock-derived live event's `sectionSources` (Cologne
 * today) — identical bytes to the constant swiss-results used before.
 */
export const SECTION_SOURCES: Readonly<Record<number, SectionSource>> =
  currentEvent().sectionSources;
