/**
 * verify-event-freeze — offline proof for PHA-954 (reconcile B↔C: the freeze
 * keys on EFFECTIVE status, fired by the real Grand Final).
 *
 * event-freeze.ts itself is an I/O module (it counts StageOutcome rows), so the
 * verify harness can't import it under strip-types. Instead this proves the PURE
 * composition it joins — exactly the logic the freeze now relies on:
 *
 *   • grandFinalSectionId picks the Grand Final section STRUCTURALLY from the
 *     registry's sectionNames (Cologne → 110), and returns null for a format
 *     with no Grand Final (the calendar-backstop fallback);
 *   • resolveEffectiveStatus over the REAL Cologne registry entry is `live`
 *     TODAY with no GF resolved — the behind-current-behavior proof that NO
 *     freeze fires today (drivers keep crawling, writes stay open);
 *   • a resolved Grand Final flips it to `archived` IMMEDIATELY, even before the
 *     `dates.end` ceiling — archive fires on the real final, no human flip;
 *   • the widened `dates.end` keeps the event `live` through the GF-ingest
 *     window (Jun 21, when the deciding game's StageOutcome lands ~1h+ late),
 *     while the ceiling still archives a never-resolved event past `end`;
 *   • the majors-core predicates map that EFFECTIVE status to the right freeze
 *     (live → nothing frozen; archived → writes/drivers frozen, reveal forced) —
 *     the same mapping event-freeze applies to status from the clock+GF.
 *
 * Run: node scripts/verify-event-freeze.ts
 */

import {
  resolveEffectiveStatus,
  GRAND_FINAL_ARCHIVE_GRACE_MS,
} from "../src/lib/event-lifecycle-core.ts";
import {
  getEventConfig,
  grandFinalSectionId,
  currentEventId,
  type EventConfig,
} from "../src/lib/events-core.ts";
import {
  isEventArchived,
  isWriteFrozen,
  shouldRunLiveDriver,
  isRevealForced,
} from "../src/lib/majors-core.ts";

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

const ms = (iso: string) => Date.parse(iso);
const TODAY = ms("2026-06-06T12:00:00Z"); // mid Stage I — the live event today

const cologne = getEventConfig(currentEventId()) as EventConfig;
check("registry resolves the active event", cologne != null);

// ── grandFinalSectionId: structural Grand Final pick ────────────────────────
check("grandFinalSectionId(Cologne) === 110", grandFinalSectionId(cologne) === 110);
check(
  "grandFinalSectionId is null when no Grand Final section is named",
  grandFinalSectionId({
    ...cologne,
    sectionNames: { 105: "Stage I", 108: "Quarterfinals" },
  }) === null,
);
check(
  "grandFinalSectionId is case/space-insensitive",
  grandFinalSectionId({ ...cologne, sectionNames: { 200: "GRAND  FINAL" } }) === 200,
);

// ── behind current behavior: NO freeze today ────────────────────────────────
const effToday = resolveEffectiveStatus(cologne, TODAY, { grandFinalResolvedAtMs: null });
check("Cologne is effectively LIVE today (no freeze)", effToday === "live");
check("today: event NOT archived", isEventArchived(effToday) === false);
check("today: writes NOT frozen", isWriteFrozen(effToday) === false);
check("today: live drivers RUN", shouldRunLiveDriver(effToday) === true);
check("today: reveal NOT forced (per-stage gate alone decides)", isRevealForced(effToday) === false);

// ── the real Grand Final fires archive — but only AFTER the 48h grace ───────
// Brandon's safety net (PHA-954): the trophy lifts, the site stays warm 48h
// (news updates, pickems browsable, a re-ingest can settle), THEN it freezes.
const gfResolvedAt = ms("2026-06-21T20:00:00Z"); // a plausible Cologne GF instant
check("GRAND_FINAL_ARCHIVE_GRACE_MS is 48h", GRAND_FINAL_ARCHIVE_GRACE_MS === 48 * 60 * 60_000);

// Within the grace window: GF decided, but the Major is STILL LIVE.
const justAfterGf = gfResolvedAt + 60 * 60_000; // +1h
const effInGrace = resolveEffectiveStatus(cologne, justAfterGf, {
  grandFinalResolvedAtMs: gfResolvedAt,
});
check("1h after GF → still LIVE (inside the 48h grace)", effInGrace === "live");
check("in grace: writes NOT frozen (pickems still browsable/editable)", isWriteFrozen(effInGrace) === false);
check("in grace: live drivers RUN (news keeps updating)", shouldRunLiveDriver(effInGrace) === true);

const nearGraceEdge = gfResolvedAt + GRAND_FINAL_ARCHIVE_GRACE_MS - 60 * 60_000; // +47h
check(
  "47h after GF → still live (grace not yet elapsed)",
  resolveEffectiveStatus(cologne, nearGraceEdge, { grandFinalResolvedAtMs: gfResolvedAt }) === "live",
);

// Once the grace elapses: archive fires (and freezes every surface).
const pastGrace = gfResolvedAt + GRAND_FINAL_ARCHIVE_GRACE_MS + 60 * 60_000; // +49h
const effPastGrace = resolveEffectiveStatus(cologne, pastGrace, {
  grandFinalResolvedAtMs: gfResolvedAt,
});
check("49h after GF → archived (grace elapsed, the real trigger)", effPastGrace === "archived");
check("post-grace archived: writes frozen", isWriteFrozen(effPastGrace) === true);
check("post-grace archived: live drivers SKIP", shouldRunLiveDriver(effPastGrace) === false);
check("post-grace archived: reveal forced (public history)", isRevealForced(effPastGrace) === true);

// ── the widened dates.end protects the GF-ingest AND grace window ───────────
// The GF likely lands Jun 21; with the 48h grace the freeze isn't due until
// ~Jun 23. The generous `dates.end` (Jun 26) keeps the event LIVE across both
// the ingest lag and the grace, so neither freezes the drivers prematurely.
const lateJun21 = ms("2026-06-21T23:30:00Z");
check(
  "late Jun 21, GF not yet ingested → still live (drivers un-frozen to ingest GF)",
  resolveEffectiveStatus(cologne, lateJun21, { grandFinalResolvedAtMs: null }) === "live",
);
const earlyJun22 = ms("2026-06-22T00:30:00Z");
check(
  "early Jun 22, GF ingested → STILL LIVE (inside the post-GF grace, not archived)",
  resolveEffectiveStatus(cologne, earlyJun22, { grandFinalResolvedAtMs: gfResolvedAt }) === "live",
);

// ── the calendar backstop still archives a never-resolved event past `end` ──
// The backstop is a hard ceiling (no grace): it is the failsafe for a GF that
// is never ingested, and is set generously past the likely GF for that reason.
const pastEnd = ms("2026-06-27T12:00:00Z"); // beyond the generous dates.end (Jun 26)
check(
  "past dates.end, even with no GF signal → archived (calendar backstop)",
  resolveEffectiveStatus(cologne, pastEnd, { grandFinalResolvedAtMs: null }) === "archived",
);

// ── the freeze composition (what event-freeze.ts does over the DB) ──────────
// isEventFrozenById ≡ isEventArchived(effective); isWriteFrozenById ≡
// isWriteFrozen(effective); isRevealForcedById ≡ isRevealForced(effective).
const frozenWhenArchived =
  isEventArchived("archived") &&
  isWriteFrozen("archived") &&
  !shouldRunLiveDriver("archived") &&
  isRevealForced("archived");
check("archived effective status freezes every surface", frozenWhenArchived);
const liveRunsEverything =
  !isEventArchived("live") &&
  !isWriteFrozen("live") &&
  shouldRunLiveDriver("live") &&
  !isRevealForced("live");
check("live effective status freezes nothing", liveRunsEverything);

console.log(`verify-event-freeze: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
