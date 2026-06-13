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
import { isSwissSection } from "./swiss-bucket-core";
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
  // trigger — that is the Grand Final StageOutcome resolving PLUS its 48h grace
  // window (PHA-954, via `grandFinalResolvedAtMs` + GRAND_FINAL_ARCHIVE_GRACE_MS).
  // It must sit comfortably past `GF + 48h` so the backstop never preempts the
  // grace: the GF is scheduled ~Jun 21 and could slip a day, its outcome row
  // lands ~1h+ late, then the site stays warm 48h (news settles, pickems
  // browsable) before archiving. So the ceiling is set generously to Jun 26 —
  // late enough that even a slipped GF gets its full grace, while still being a
  // hard failsafe for a GF that is somehow NEVER ingested. The GF signal — not
  // the clock — fires the real archive. See PHA-954.
  dates: { start: "2026-06-02T00:00:00Z", end: "2026-06-26T23:59:59Z" },
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
    // Stage III (PHA-926). Unlike Stages I/II, HLTV did NOT mint a dedicated
    // sub-event id for Stage 3 — it runs Stage 3 + Playoffs under the parent
    // major hub (event 8301). Verified on the live hub (2026-06-09): its
    // crawled markdown renders the active stage's `Group Swiss | … | Record`
    // table, which during the Stage III window (Jun 11–14) is exactly the
    // Stage 3 field — parseHltvSwissStandings pulls all 16 seeds from it, and
    // the 8 round-1 `data-match-details-popup-json` blocks drive the bracket.
    // So the hub IS the Stage III source; there is no `…-stage-3` page to wait
    // for. The hourly crawl is match-window-gated, so it only reads the hub
    // during Jun 11–14 when "current stage" == Stage 3.
    107: {
      url: "https://www.hltv.org/events/8301/iem-cologne-major-2026",
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
 * PGL Major Singapore 2026 — the NEXT Major, pre-seeded as `upcoming` (PHA-1055,
 * leaning on the multi-major backbone PHA-948/949/950). It resolves `upcoming`
 * purely from the clock today and has ZERO impact on live Cologne:
 * `selectCurrentEvent` prefers the effectively-live event, so Cologne stays the
 * served Major until it archives, after which the site counts down to this one.
 *
 * Confirmed facts (PHA-1048 research): PGL · Singapore Indoor Stadium · 32 teams
 * · $1.25M prize pool · BO5 Grand Final. Main event runs Nov 25 – Dec 13 2026,
 * playoffs/finals Dec 10–13. These descriptive facts (org/prize/format/venue)
 * have no field on `EventConfig` and intentionally live in this doc comment —
 * the registry indexes *config*, and adding consumer-less fields would be scope
 * creep. They're the seed record for the re-point runbook (docs/NEXT-MAJOR.md).
 *
 * GATED until ~Oct/Nov 2026 — left deliberately EMPTY so both CI guards pass
 * (an empty config has nothing to validate) and nothing renders half-built:
 *   • `sectionNames` — empty. Declaring "Stage N" names before their section ids
 *     are wired into `isSwissSection` would trip `validateSwissClassification`
 *     (the PHA-946 regression guard). Fill when the layout fixture lands.
 *   • `lockSchedule` / `matchWindows` — empty. Only the overall window + the
 *     Dec 10–13 finals are dated today; precise stage day-splits are unpublished.
 *   • `sectionSources` — empty. HLTV mints per-stage event ids (mirror Cologne's
 *     9028/9029 + the 8301 hub) only once stage pages exist (~Oct/Nov). The
 *     PHA-926-style watcher pulls them the moment they publish.
 *
 * `eventId: 27` is PROVISIONAL — Valve's tournament id for this Major isn't
 * published yet (Cologne is 26; 27 is the natural next). It's only a unique
 * registry key today (no fixture asserts it while the event is `upcoming`);
 * Phase 1a of the runbook replaces it with the real id when the layout lands.
 * Likewise `fixtures`/`teamMaps` name the files/modules the re-point will fill.
 */
const SINGAPORE_2026: EventConfig = {
  eventId: 27,
  slug: "pgl-singapore-2026",
  name: "PGL Major Singapore 2026",
  status: "upcoming",
  // Main event Nov 25 – Dec 13 2026 (playoffs/finals Dec 10–13, Singapore Indoor
  // Stadium). `end` is the calendar BACKSTOP for the archive transition, set a
  // touch past the Dec 13 finals so it sits comfortably beyond GF + the 48h grace
  // (PHA-954) — the real archive fires on the Grand Final resolving, not this
  // ceiling (mirrors Cologne's reasoning). Refine both dates when stage day-
  // splits publish.
  dates: { start: "2026-11-25T00:00:00Z", end: "2026-12-15T23:59:59Z" },
  sectionNames: {},
  lockSchedule: {},
  matchWindows: {},
  sectionSources: {},
  fixtures: { layout: "pgl-singapore-2026-layout", logos: "pgl-singapore-2026-logos" },
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
  [SINGAPORE_2026.eventId]: SINGAPORE_2026,
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
 * A section is a Swiss stage (interchangeable buckets, set-valued scoring) iff
 * its display name reads "Stage <n>"; the playoff rounds (Quarterfinal /
 * Semifinal / Grand Final) are per-match. This is the structural truth the
 * registry declares via `sectionNames`. `isSwissSection` answers the same
 * question from a hardcoded id set — the two MUST agree (see below).
 */
function isStructurallySwiss(sectionName: string): boolean {
  return /^stage\b/i.test(sectionName.trim());
}

/**
 * Future-proof guard for PHA-946 (compare/scoring bucket grain). Returns the
 * list of sections where the structural Swiss-ness declared by the registry's
 * `sectionNames` disagrees with `isSwissSection`'s hardcoded id set. Empty = OK.
 *
 * Why this matters across majors: the compare grid, the steal reel, scoring,
 * the picks board and the consensus line ALL branch on `isSwissSection`. If a
 * future major registers a Swiss stage whose id isn't in that set, every one of
 * them silently reverts to strict per-slot matching — re-introducing the exact
 * PHA-946 bug (a correct pick in a non-winner slot reads as a miss) AND breaking
 * the score, with no divergence between them to catch it at runtime. This guard
 * fails the build the moment a registered "Stage N" id isn't recognized as
 * Swiss (or a playoff round wrongly is), so the misconfig can never ship.
 *
 * Pure; no I/O. The canonical long-term fix is to make `isSwissSection` read the
 * active event's sections directly (the PHA-952 registry cutover); until then
 * this keeps the hardcoded set honest against whatever event is live.
 */
export function validateSwissClassification(event: EventConfig): string[] {
  const problems: string[] = [];
  const tag = `event ${event.eventId} (${event.slug})`;
  for (const [key, name] of Object.entries(event.sectionNames)) {
    const id = Number(key);
    const declaredSwiss = isStructurallySwiss(name);
    const recognizedSwiss = isSwissSection(id);
    if (declaredSwiss && !recognizedSwiss)
      problems.push(`${tag}: section ${id} "${name}" is a Swiss stage but isSwissSection() does not recognize it — compare/scoring/picks would judge it per-slot (PHA-946 regression)`);
    if (!declaredSwiss && recognizedSwiss)
      problems.push(`${tag}: section ${id} "${name}" is a playoff round but isSwissSection() treats it as Swiss — interchangeable bucketing would be applied to per-match picks`);
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
