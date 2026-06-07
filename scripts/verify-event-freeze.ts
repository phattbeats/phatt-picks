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

import { resolveEffectiveStatus } from "../src/lib/event-lifecycle-core.ts";
import {
  getEventConfig,
  grandFinalSectionId,
  ACTIVE_EVENT_ID,
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

const cologne = getEventConfig(ACTIVE_EVENT_ID) as EventConfig;
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
const effToday = resolveEffectiveStatus(cologne, TODAY, { grandFinalResolved: false });
check("Cologne is effectively LIVE today (no freeze)", effToday === "live");
check("today: event NOT archived", isEventArchived(effToday) === false);
check("today: writes NOT frozen", isWriteFrozen(effToday) === false);
check("today: live drivers RUN", shouldRunLiveDriver(effToday) === true);
check("today: reveal NOT forced (per-stage gate alone decides)", isRevealForced(effToday) === false);

// ── the real Grand Final fires archive — before the dates.end ceiling ───────
const effGfMidEvent = resolveEffectiveStatus(cologne, TODAY, { grandFinalResolved: true });
check("GF resolved mid-event → archived immediately", effGfMidEvent === "archived");
check("GF archived: writes frozen", isWriteFrozen(effGfMidEvent) === true);
check("GF archived: live drivers SKIP", shouldRunLiveDriver(effGfMidEvent) === false);
check("GF archived: reveal forced (public history)", isRevealForced(effGfMidEvent) === true);

// ── the widened dates.end protects the GF-ingest window ─────────────────────
// The GF likely lands Jun 21; its StageOutcome can land ~1h+ later (Jun 22 UTC).
// With the generous ceiling the event stays LIVE through that window so the
// drivers can INGEST the GF result instead of freezing on a tight Jun-21 end.
const lateJun21 = ms("2026-06-21T23:30:00Z");
check(
  "late Jun 21, GF not yet ingested → still live (drivers un-frozen to ingest GF)",
  resolveEffectiveStatus(cologne, lateJun21, { grandFinalResolved: false }) === "live",
);
const earlyJun22 = ms("2026-06-22T00:30:00Z");
check(
  "early Jun 22, GF not yet ingested → still live (within the buffer)",
  resolveEffectiveStatus(cologne, earlyJun22, { grandFinalResolved: false }) === "live",
);
check(
  "early Jun 22, GF ingested → archived (the real trigger)",
  resolveEffectiveStatus(cologne, earlyJun22, { grandFinalResolved: true }) === "archived",
);

// ── the calendar backstop still archives a never-resolved event past `end` ──
const pastEnd = ms("2026-06-25T12:00:00Z"); // beyond the generous dates.end
check(
  "past dates.end, even with no GF signal → archived (calendar backstop)",
  resolveEffectiveStatus(cologne, pastEnd, { grandFinalResolved: false }) === "archived",
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
