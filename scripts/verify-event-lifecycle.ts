/**
 * verify-event-lifecycle - offline proof for PHA-950 (self-sustaining lifecycle).
 *
 * Proves the clock-driven derivation so no human flips the registry's `status`:
 *   • a Major staged `upcoming` is upcoming before its go-live instant and flips
 *     to `live` on its own once the clock crosses it (the staging lead);
 *   • a `live` Major stays live through its run window and flips to `archived`
 *     the moment its Grand Final resolves — and, failing that signal, when the
 *     clock passes `dates.end`;
 *   • the lifecycle is MONOTONIC: an `archived` baseline is terminal and a
 *     `live` baseline is never demoted to `upcoming` (the forward-only clamp);
 *   • selectLiveEvents returns what the drivers iterate (0 between Majors, 1
 *     normally, >1 across an overlap) and selectCurrentEvent always picks a
 *     sane event to show (live > soonest-upcoming > most-recent-archived);
 *   • the Cologne-today case still derives `live` — i.e. this lands behind
 *     current behaviour, exactly like the registry it extends.
 *
 * Run: node scripts/verify-event-lifecycle.ts
 */

import {
  resolveEffectiveStatus,
  isEffectivelyLive,
  firstLockMs,
  goLiveMs,
  selectLiveEvents,
  selectCurrentEvent,
  DEFAULT_GO_LIVE_LEAD_MS,
  ANTICIPATION_LEAD_MS,
  type LifecycleEvent,
} from "../src/lib/event-lifecycle-core.ts";
import {
  liveEvents,
  currentEvent,
  currentEventId,
  resolveActiveEvent,
} from "../src/lib/events-core.ts";

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

const DAY = 24 * 60 * 60_000;
const ms = (iso: string) => Date.parse(iso);

// A Cologne-shaped live Major (the real lock instants from lock-schedule-core).
const cologne: LifecycleEvent = {
  eventId: 26,
  status: "live",
  dates: { start: "2026-06-02T00:00:00Z", end: "2026-06-21T23:59:59Z" },
  lockSchedule: {
    105: "2026-06-02T10:30:00Z",
    106: "2026-06-06T10:30:00Z",
    107: "2026-06-11T10:30:00Z",
  },
};

// The NEXT Major, staged as `upcoming` with future dates — the whole point of C.
const nextMajor: LifecycleEvent = {
  eventId: 27,
  status: "upcoming",
  dates: { start: "2026-09-01T00:00:00Z", end: "2026-09-20T23:59:59Z" },
  lockSchedule: { 205: "2026-09-01T10:30:00Z" },
};

// — firstLock / goLive anchors —
check("firstLockMs picks the earliest stage lock", firstLockMs(cologne) === ms("2026-06-02T10:30:00Z"));
check("firstLockMs is null when no schedule", firstLockMs({ ...cologne, lockSchedule: {} }) === null);
check(
  "goLive is start-or-(firstLock−lead), whichever is earlier",
  goLiveMs(cologne) === Math.min(ms("2026-06-02T00:00:00Z"), ms("2026-06-02T10:30:00Z") - DEFAULT_GO_LIVE_LEAD_MS),
);
check(
  "goLive falls back to dates.start when no lock schedule",
  goLiveMs({ ...nextMajor, lockSchedule: {} }) === ms("2026-09-01T00:00:00Z"),
);

// — Cologne TODAY (2026-06-06) is effectively live: lands behind current behavior —
const JUN6 = ms("2026-06-06T12:00:00Z");
check("Cologne is effectively live on 2026-06-06", resolveEffectiveStatus(cologne, JUN6) === "live");
check("isEffectivelyLive agrees for Cologne today", isEffectivelyLive(cologne, JUN6) === true);

// — upcoming → live fires on its own as the clock crosses go-live —
const nextGoLive = goLiveMs(nextMajor);
check("next Major is `upcoming` a day before go-live", resolveEffectiveStatus(nextMajor, nextGoLive - DAY) === "upcoming");
check("next Major flips to `live` at go-live — no human touched it", resolveEffectiveStatus(nextMajor, nextGoLive) === "live");
check("next Major is `live` mid-run", resolveEffectiveStatus(nextMajor, ms("2026-09-05T00:00:00Z")) === "live");
check("a far-future now leaves next Major upcoming earlier than lead", resolveEffectiveStatus(nextMajor, ms("2026-08-01T00:00:00Z")) === "upcoming");

// — live → archived on Grand Final resolve + its 48h grace (before dates.end) —
const MIDRUN = ms("2026-06-15T00:00:00Z"); // within Cologne's window
const GF_AT = ms("2026-06-12T00:00:00Z");  // GF resolved 3 days before MIDRUN
check("GF resolved AND 48h grace elapsed → archived (before dates.end)", resolveEffectiveStatus(cologne, MIDRUN, { grandFinalResolvedAtMs: GF_AT }) === "archived");
check("GF resolved but still inside the 48h grace → stays live", resolveEffectiveStatus(cologne, ms("2026-06-12T12:00:00Z"), { grandFinalResolvedAtMs: GF_AT }) === "live");
check("postGrandFinalGraceMs: 0 → archives the instant the GF resolves", resolveEffectiveStatus(cologne, MIDRUN, { grandFinalResolvedAtMs: MIDRUN, postGrandFinalGraceMs: 0 }) === "archived");
check("without the GF signal, mid-window stays live", resolveEffectiveStatus(cologne, MIDRUN) === "live");

// — live → archived by the dates.end ceiling when no GF signal arrives —
check("past dates.end → archived (the safety ceiling)", resolveEffectiveStatus(cologne, ms("2026-06-22T01:00:00Z")) === "archived");

// — MONOTONIC clamp: forward only —
check("archived baseline is terminal (never resurrected by the clock)", resolveEffectiveStatus({ ...cologne, status: "archived" }, JUN6) === "archived");
check("live baseline is never demoted to upcoming", resolveEffectiveStatus({ ...cologne, status: "live" }, ms("2026-05-01T00:00:00Z")) === "live");
check("upcoming baseline can advance to live", resolveEffectiveStatus({ ...cologne, status: "upcoming" }, JUN6) === "live");

// — selectLiveEvents: what the drivers iterate —
const registry = [cologne, nextMajor];
check("one live event mid-Cologne, before next is staged in", selectLiveEvents(registry, JUN6).length === 1);
check("the live event mid-Cologne is Cologne", selectLiveEvents(registry, JUN6)[0]?.eventId === 26);
check("zero live in the off-season gap (Cologne archived via GF, next not yet up)",
  selectLiveEvents(registry, ms("2026-07-15T00:00:00Z"), (e) => (e.eventId === 26 ? { grandFinalResolvedAtMs: ms("2026-06-11T00:00:00Z") } : {})).length === 0);
// overlap: Cologne still within window (no GF signal) while next has crossed go-live
const overlapNext: LifecycleEvent = { ...nextMajor, dates: { start: "2026-06-18T00:00:00Z", end: "2026-07-05T00:00:00Z" }, lockSchedule: { 205: "2026-06-18T10:30:00Z" } };
check("brief overlap yields two live events", selectLiveEvents([cologne, overlapNext], ms("2026-06-19T00:00:00Z")).length === 2);

// — selectCurrentEvent: always something sane to show —
check("current event mid-Cologne is the live one", selectCurrentEvent(registry, JUN6)?.eventId === 26);
check("in the gap, once the next Major is WITHIN its anticipation window, it is current",
  selectCurrentEvent(registry, ms("2026-07-15T00:00:00Z"), (e) => (e.eventId === 26 ? { grandFinalResolvedAtMs: ms("2026-06-11T00:00:00Z") } : {}))?.eventId === 27);
check("with only an archived Major, current event is that archived one (off-season)",
  selectCurrentEvent([{ ...cologne, status: "archived" }], ms("2027-01-01T00:00:00Z"))?.eventId === 26);
check("empty registry → null", selectCurrentEvent([], JUN6) === null);
check("among two archived, current picks the most-recently-concluded",
  selectCurrentEvent(
    [
      { ...cologne, eventId: 26, status: "archived" },
      { ...nextMajor, eventId: 27, status: "archived", dates: { start: "2026-09-01T00:00:00Z", end: "2026-09-20T23:59:59Z" } },
    ],
    ms("2027-01-01T00:00:00Z"),
  )?.eventId === 27);

// — anticipation window (PHA-1048): a far-future upcoming Major must NOT hijack
//   the site the instant the prior one archives; the last Major stays the face
//   until the next is within ANTICIPATION_LEAD_MS of go-live. nextMajor's go-live
//   is 2026-08-25 (start Sep 1, firstLock-lead earlier), so its window opens ~Jul 11.
const nextGoLiveAnchor = goLiveMs(nextMajor);
check("FAR-OUT next Major does not preempt the just-archived one (off-season holds on the last Major)",
  // 2026-07-01 is before the window opens AND past Cologne's dates.end (Jun 21) → Cologne archived → it stays current.
  selectCurrentEvent(registry, ms("2026-07-01T00:00:00Z"))?.eventId === 26);
check("once INSIDE the anticipation window, the next Major takes over (still pre-go-live)",
  // 2026-08-01: inside the window, nextMajor still `upcoming` (go-live Aug 25), Cologne long archived.
  selectCurrentEvent(registry, ms("2026-08-01T00:00:00Z"))?.eventId === 27);
check("window edge is inclusive: exactly ANTICIPATION_LEAD_MS before go-live → next Major is current",
  selectCurrentEvent([{ ...cologne, status: "archived" }, nextMajor], nextGoLiveAnchor - ANTICIPATION_LEAD_MS)?.eventId === 27);
check("one ms before the window opens → still the archived Major",
  selectCurrentEvent([{ ...cologne, status: "archived" }, nextMajor], nextGoLiveAnchor - ANTICIPATION_LEAD_MS - 1)?.eventId === 26);
check("brand-new site (only a far-future upcoming, nothing archived) still shows it — no blank page",
  selectCurrentEvent([nextMajor], ms("2026-07-01T00:00:00Z"))?.eventId === 27);

// — PHA-1046: upcoming countdown ranks by GENUINE start, not lead-adjusted
//   go-live. A genuinely-sooner Major (sooner dates.start) must win even when a
//   later one's match-day lock schedule pulls ITS go-live earlier via the 7d
//   staging lead. sooner = eventId 30 (starts Aug 10, no lock published yet);
//   later = eventId 31 (starts Aug 14, but a match-day first lock makes its
//   go-live Aug 07 — earlier than 30's). The OLD by-go-live sort picked 31. —
const sooner: LifecycleEvent = {
  eventId: 30, status: "upcoming",
  dates: { start: "2026-08-10T00:00:00Z", end: "2026-08-28T23:59:59Z" },
  lockSchedule: {},
};
const later: LifecycleEvent = {
  eventId: 31, status: "upcoming",
  dates: { start: "2026-08-14T00:00:00Z", end: "2026-09-01T23:59:59Z" },
  lockSchedule: { 300: "2026-08-14T12:00:00Z" },
};
const beforeBoth = ms("2026-08-01T00:00:00Z");
check("the later Major's lead-adjusted go-live IS earlier (the trap)",
  goLiveMs(later) < goLiveMs(sooner));
check("upcoming countdown picks the genuinely-sooner-STARTING Major (not the earlier go-live)",
  selectCurrentEvent([later, sooner], beforeBoth)?.eventId === 30);
check("ordering is independent of input order",
  selectCurrentEvent([sooner, later], beforeBoth)?.eventId === 30);
// an unparseable start sorts LAST so it never hijacks the countdown:
const badStart: LifecycleEvent = {
  eventId: 32, status: "upcoming",
  dates: { start: "garbage", end: "2026-08-05T00:00:00Z" },
  lockSchedule: {},
};
check("an event with an unparseable start never wins the upcoming slot",
  selectCurrentEvent([badStart, sooner], beforeBoth)?.eventId === 30);

// — events-core is now CLOCK-DERIVED but lands behind current behaviour —
// (the live registry holds only Cologne, so these hold whenever verify runs).
check("liveEvents(Jun6) is exactly [Cologne]", liveEvents(JUN6).length === 1 && liveEvents(JUN6)[0]?.eventId === 26);
check("currentEvent(Jun6) is Cologne and effectively live", currentEvent(JUN6).eventId === 26 && currentEvent(JUN6).status === "live");
check("currentEventId(Jun6) === 26", currentEventId(JUN6) === 26);
check("resolveActiveEvent(Jun6) === 26 (clock-derived, same as before)", resolveActiveEvent(JUN6).eventId === 26);
// PHA-1046: pages/routes now resolve the event PER REQUEST via currentEventId(),
// not a module-load-bound ACTIVE_EVENT_ID — so a between-Majors transition is
// followed without a redeploy. currentEventId(now) is the value they read.
check("currentEventId(Jun6) is 26 (the value pages read, per-request)", currentEventId(JUN6) === 26);
// the reminder driver reads each live event's OWN schedule from the registry:
check("live event exposes its own lockSchedule (drives reminders)", Object.keys(liveEvents(JUN6)[0]?.lockSchedule ?? {}).length >= 3);
// pre-go-live: a far-earlier clock still serves Cologne (it never demotes below its live baseline)
check("before go-live the live registry still serves Cologne", currentEventId(ms("2026-01-01T00:00:00Z")) === 26);

console.log(`\nverify-event-lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
