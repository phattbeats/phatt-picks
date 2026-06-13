/**
 * verify-events - offline proof for PHA-948 (event registry + active event).
 *
 * The registry is the backbone of multi-major support. This proves:
 *   • exactly one event is `live`, and resolveActiveEvent() returns it;
 *   • ACTIVE_EVENT_ID equals that event's id (the value the ~15 pages/routes
 *     used to hardcode as `26`) — i.e. the refactor is behind current behavior;
 *   • getEventConfig() round-trips by id and is null for an unregistered id;
 *   • the active event's identity matches the committed layout fixture
 *     (eventId === result.event, name === result.name) — the registry can't
 *     drift from the fixture it indexes;
 *   • the per-event config the registry references IS the committed
 *     lock-schedule constants (no duplicate, no drift);
 *   • SECTION_SOURCES (what swiss-results.ts now imports) equals the active
 *     event's sectionSources and still maps the Cologne Swiss stages.
 *
 * Run: node scripts/verify-events.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVENTS,
  getEventConfig,
  resolveActiveEvent,
  ACTIVE_EVENT_ID,
  SECTION_SOURCES,
  validateEventRevealConfig,
  validateSwissClassification,
  type EventConfig,
} from "../src/lib/events-core.ts";
import {
  COLOGNE_LOCK_SCHEDULE,
  COLOGNE_MATCH_WINDOWS,
  COLOGNE_SECTION_NAMES,
} from "../src/lib/lock-schedule-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

interface LayoutResult {
  result: { event: number; name: string };
}
const layout = (JSON.parse(read("src/fixtures/cologne-layout.json")) as LayoutResult)
  .result;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// — exactly one live event, and it is what resolves —
const liveEntries = Object.values(EVENTS).filter((e) => e.status === "live");
check("exactly one live event in the registry", liveEntries.length === 1);

const active = resolveActiveEvent();
check("resolveActiveEvent() returns the live event", active.status === "live");
check("active event id is 26 (Cologne — current behavior)", active.eventId === 26);
check("ACTIVE_EVENT_ID === active.eventId", ACTIVE_EVENT_ID === active.eventId);
check("ACTIVE_EVENT_ID === 26 (the value pages hardcoded before)", ACTIVE_EVENT_ID === 26);

// — getEventConfig round-trips and is honest about misses —
check("getEventConfig(26) returns the active event", getEventConfig(26) === active);
check("getEventConfig(999) is null for an unregistered id", getEventConfig(999) === null);
check("getEventConfig(0) is null", getEventConfig(0) === null);

// — registry identity matches the committed layout fixture —
check("active.eventId === layout result.event", active.eventId === layout.event);
check("active.name === layout result.name", active.name === layout.name);
check("active.slug is a non-empty url-safe handle", /^[a-z0-9-]+$/.test(active.slug));

// — the per-event config references the committed constants (no drift) —
check("lockSchedule IS COLOGNE_LOCK_SCHEDULE", active.lockSchedule === COLOGNE_LOCK_SCHEDULE);
check("matchWindows IS COLOGNE_MATCH_WINDOWS", active.matchWindows === COLOGNE_MATCH_WINDOWS);
check("sectionNames IS COLOGNE_SECTION_NAMES", active.sectionNames === COLOGNE_SECTION_NAMES);

// — sectionSources / SECTION_SOURCES (consumed by swiss-results) —
check("SECTION_SOURCES === active.sectionSources", SECTION_SOURCES === active.sectionSources);
check("Stage I (105) maps to HLTV event 9028", SECTION_SOURCES[105]?.url.includes("/9028/") === true);
check("Stage II (106) maps to HLTV event 9029", SECTION_SOURCES[106]?.url.includes("/9029/") === true);
check("every section source has a label", Object.values(SECTION_SOURCES).every((s) => !!s.label));

// — dates + resource bindings are present and well-formed —
check("dates.start parses", !Number.isNaN(Date.parse(active.dates.start)));
check("dates.end parses and is after start", Date.parse(active.dates.end) > Date.parse(active.dates.start));
check("fixtures.layout names the committed fixture", active.fixtures.layout === "cologne-layout");
check("fixtures.logos names the committed manifest", active.fixtures.logos === "cologne-logos");
check("teamMaps record the owning modules", !!active.teamMaps.regions && !!active.teamMaps.stats && !!active.teamMaps.sources);

// — PHA-1055: the next Major (PGL Singapore 2026) is pre-seeded as `upcoming`,
//   fully gated (no section-keyed config yet) so it has zero impact on live
//   Cologne and both CI guards pass on an empty config. —
const singapore = getEventConfig(27);
check("Singapore 2026 is registered (eventId 27)", singapore !== null);
check("Singapore is staged as upcoming", singapore?.status === "upcoming");
check("Singapore slug is pgl-singapore-2026", singapore?.slug === "pgl-singapore-2026");
check("Singapore dates parse and end after start",
  !!singapore &&
  !Number.isNaN(Date.parse(singapore.dates.start)) &&
  Date.parse(singapore.dates.end) > Date.parse(singapore.dates.start));
check("Singapore start is Nov 25 2026 (main event opener)",
  singapore?.dates.start === "2026-11-25T00:00:00Z");
check("Singapore section-keyed config is gated (empty until HLTV publishes)",
  !!singapore &&
  Object.keys(singapore.sectionNames).length === 0 &&
  Object.keys(singapore.lockSchedule).length === 0 &&
  Object.keys(singapore.matchWindows).length === 0 &&
  Object.keys(singapore.sectionSources).length === 0);
check("Singapore records its fixture/teamMap bindings for the re-point",
  !!singapore && !!singapore.fixtures.layout && !!singapore.fixtures.logos &&
  !!singapore.teamMaps.regions && !!singapore.teamMaps.stats && !!singapore.teamMaps.sources);
check("seeding Singapore did not disturb the single live event (Cologne)",
  Object.values(EVENTS).filter((e) => e.status === "live").length === 1 &&
  resolveActiveEvent().eventId === 26);

// — config-sanity invariant: at most one BASELINE-live event. (resolveActiveEvent
//   is clock-derived since PHA-950 and no longer throws on multiples — it picks
//   the soonest go-live — but two hand-set `live` baselines is still a config
//   smell: which one is the canonical current Major is then ambiguous.) —
check(
  "registry has no second baseline-live event",
  Object.values(EVENTS).filter((e) => e.status === "live").length === 1,
);

// — future-major guard (PHA-943): every registered event's reveal config is
//   internally consistent, so the next Major's half-filled config fails loudly
//   here, not silently at runtime. Run over ALL events (an `upcoming` entry
//   being prepped is validated before it ever goes live). —
for (const e of Object.values(EVENTS)) {
  const problems = validateEventRevealConfig(e);
  if (problems.length > 0) for (const p of problems) console.error(`    · ${p}`);
  check(`reveal config consistent for event ${e.eventId} (${e.slug})`, problems.length === 0);
}
check("active event's reveal config is consistent", validateEventRevealConfig(active).length === 0);

// — anti-rigging: the guard actually FIRES on each broken shape (so a future
//   green run means the config is right, not that the check is toothless). —
const base: EventConfig = {
  ...active,
  lockSchedule: { 200: "2027-01-02T10:30:00Z" },
  matchWindows: { 200: { start: "2027-01-02T00:00:00Z", end: "2027-01-05T23:59:59Z" } },
  sectionSources: { 200: { url: "https://hltv.org/events/1/x", label: "HLTV" } },
};
check("guard passes a fully-consistent synthetic event", validateEventRevealConfig(base).length === 0);
check(
  "guard flags a source with no lockSchedule entry",
  validateEventRevealConfig({ ...base, lockSchedule: {} }).some((p) => p.includes("no lockSchedule")),
);
check(
  "guard flags a source with no matchWindows entry",
  validateEventRevealConfig({ ...base, matchWindows: {} }).some((p) => p.includes("no matchWindows")),
);
check(
  "guard flags an orphaned window (window but no lock)",
  validateEventRevealConfig({
    ...base,
    lockSchedule: {},
    sectionSources: {},
  }).some((p) => p.includes("orphaned window")),
);
check(
  "guard flags a malformed lock instant",
  validateEventRevealConfig({
    ...base,
    lockSchedule: { 200: "not-a-date" },
  }).some((p) => p.includes("not a valid ISO")),
);

// — future-major guard (PHA-946): the registry's structural Swiss-ness
//   (sectionNames "Stage N") must agree with isSwissSection's hardcoded id set,
//   for EVERY registered event. A new Major that registers a Swiss stage with an
//   unrecognized id would silently revert compare/scoring/picks to per-slot
//   matching (the PHA-946 bug). This fails the build instead. —
for (const e of Object.values(EVENTS)) {
  const problems = validateSwissClassification(e);
  if (problems.length > 0) for (const p of problems) console.error(`    · ${p}`);
  check(`Swiss classification consistent for event ${e.eventId} (${e.slug})`, problems.length === 0);
}
check("active event Swiss classification is consistent", validateSwissClassification(active).length === 0);

// — anti-rigging: the guard fires on each direction of misconfiguration. —
check(
  "guard flags a Swiss-named stage with an unrecognized id (PHA-946 regression)",
  validateSwissClassification({
    ...active,
    sectionNames: { ...active.sectionNames, 211: "Stage IV" },
  }).some((p) => p.includes("does not recognize")),
);
check(
  "guard flags a playoff round wrongly recognized as Swiss",
  // 105 is a recognized Swiss id; naming it a playoff round must flag it.
  validateSwissClassification({
    ...active,
    sectionNames: { ...active.sectionNames, 105: "Quarterfinals" },
  }).some((p) => p.includes("treats it as Swiss")),
);
check(
  "guard passes the real Cologne sectionNames unchanged",
  validateSwissClassification(active).length === 0,
);

console.log(`\nverify-events: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
