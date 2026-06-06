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
  type LockSchedule,
  type MatchWindow,
} from "./lock-schedule-core";

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
