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
  dates: { start: "2026-06-02T00:00:00Z", end: "2026-06-21T23:59:59Z" },
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
 * The single event currently being run. Exactly one registry entry must be
 * `status: "live"` — this throws if zero or more than one are, because a
 * mis-edited registry should fail loudly at build/verify time, never silently
 * serve the wrong Major. (The registry is committed config, so this can only
 * trip on an edit, and verify-events.ts guards it.)
 */
export function resolveActiveEvent(): EventConfig {
  const live = Object.values(EVENTS).filter((e) => e.status === "live");
  if (live.length !== 1) {
    throw new Error(
      `event registry must have exactly one live event, found ${live.length}` +
        ` (${live.map((e) => e.eventId).join(", ") || "none"})`,
    );
  }
  return live[0];
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
 * Convenience constant for the ~15 pages/routes that previously hardcoded
 * `const EVENT_ID = 26`. Resolved once at module load from the sole live entry,
 * so every consumer shares one source of truth for the active event id.
 */
export const ACTIVE_EVENT_ID: number = resolveActiveEvent().eventId;

/**
 * The active event's HLTV Swiss sources, keyed by section id. swiss-results.ts
 * imports this so the standings/bracket crawl reads the registry rather than a
 * private duplicate. A stable reference to the live event's `sectionSources`
 * (Cologne today) — identical bytes to the constant swiss-results used before.
 */
export const SECTION_SOURCES: Readonly<Record<number, SectionSource>> =
  resolveActiveEvent().sectionSources;
