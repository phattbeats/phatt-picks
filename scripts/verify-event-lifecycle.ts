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
  type LifecycleEvent,
} from "../src/lib/event-lifecycle-core.ts";

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

// — live → archived on Grand Final resolve (before dates.end) —
const MIDRUN = ms("2026-06-15T00:00:00Z"); // within Cologne's window
check("Grand Final resolved → archived immediately, even mid-window", resolveEffectiveStatus(cologne, MIDRUN, { grandFinalResolved: true }) === "archived");
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
  selectLiveEvents(registry, ms("2026-07-15T00:00:00Z"), (e) => (e.eventId === 26 ? { grandFinalResolved: true } : {})).length === 0);
// overlap: Cologne still within window (no GF signal) while next has crossed go-live
const overlapNext: LifecycleEvent = { ...nextMajor, dates: { start: "2026-06-18T00:00:00Z", end: "2026-07-05T00:00:00Z" }, lockSchedule: { 205: "2026-06-18T10:30:00Z" } };
check("brief overlap yields two live events", selectLiveEvents([cologne, overlapNext], ms("2026-06-19T00:00:00Z")).length === 2);

// — selectCurrentEvent: always something sane to show —
check("current event mid-Cologne is the live one", selectCurrentEvent(registry, JUN6)?.eventId === 26);
check("in the gap, current event is the soonest upcoming (next Major)",
  selectCurrentEvent(registry, ms("2026-07-15T00:00:00Z"), (e) => (e.eventId === 26 ? { grandFinalResolved: true } : {}))?.eventId === 27);
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

console.log(`\nverify-event-lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
