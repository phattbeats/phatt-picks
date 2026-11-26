/**
 * verify-stage-reminder-gate — PHA-5353 regression.
 *
 * Brandon: "this stage II locks soon is WAY too early. the stages wont even
 * begin to be locked until the previous stage is on the last day." Singapore's
 * Stage II card ("Picks lock in 165 hours") appeared Nov 21 off the flat 7-day
 * lead. Rule: a stage's "locks soon" (inbox/bell entry and push) exists only
 * once the previous stage is on its last day; the first stage keeps its own.
 *
 * Checked against the REAL registry schedule (events-core: lockSchedule +
 * matchWindows), not a copy, so a schedule edit that breaks the rule fails here.
 *
 * Run via: node scripts/verify-all.mjs
 */

import { BASE_EVENTS, playoffSectionIdsFor } from "../src/lib/events-core.ts";
import { stageReminderOpensAtMs, stageLocksFromSchedule } from "../src/lib/lock-schedule-core.ts";
import { stageLockEntry } from "../src/lib/notifications-core.ts";
import { DAY_MS, HOUR_MS, dueReminders } from "../src/lib/notify-core.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.error("  ✗ " + name);
  }
}

const SG = BASE_EVENTS[27];
const ids = playoffSectionIdsFor(SG);
const opens = (sid: number) => stageReminderOpensAtMs(sid, SG.lockSchedule, SG.matchWindows, ids);
const lockMs = (sid: number) => Date.parse(SG.lockSchedule[sid]);
/** The feed entry exactly as notifications-feed builds it. */
const entry = (sid: number, nowMs: number) =>
  stageLockEntry({ sectionId: sid, stageName: SG.sectionNames[sid], lockAtMs: lockMs(sid), opensAtMs: opens(sid) }, nowMs);
/** Would the push job send anything for this stage at nowMs (any instant in the fire window)? */
const pushes = (sid: number, nowMs: number) => nowMs >= opens(sid) && dueReminders(nowMs, lockMs(sid)).length > 0;

console.log("\nschedule facts (events-core, Singapore)");
check("Stage I match window ends 2026-11-27 (its last day)", SG.matchWindows[111]?.end.startsWith("2026-11-27"));
check("Stage II locks 2026-11-28 11:00Z", SG.lockSchedule[112] === "2026-11-28T11:00:00Z");

console.log("\ngate instants");
check("Stage I (first stage) is ungated", opens(111) === -Infinity);
check("Stage II opens 2026-11-27T00:00Z (Stage I's last day)", opens(112) === Date.parse("2026-11-27T00:00:00Z"));
check("Stage III opens on Stage II's last day",
  opens(113) === Date.parse(SG.matchWindows[112].end.slice(0, 10) + "T00:00:00Z"));

console.log("\nStage II before Stage I's last day — nothing anywhere");
const reported = Date.parse("2026-11-21T11:44:00Z"); // when Brandon's card was sent
const today = Date.parse("2026-11-26T20:30:00Z");
const lastMinuteBefore = Date.parse("2026-11-26T23:59:59Z");
for (const [label, t] of [["Nov 21 (the reported card)", reported], ["Nov 26", today], ["Nov 26 23:59:59Z", lastMinuteBefore]] as const) {
  check(`no Stage II inbox entry at ${label}`, entry(112, t) === null);
}
let earliestPush = Infinity;
for (let t = lockMs(112) - 8 * DAY_MS; t < lockMs(112); t += 5 * 60_000) {
  if (pushes(112, t)) { earliestPush = t; break; }
}
check("no Stage II push before Stage I's last day (5-min sweep over 8 days)", earliestPush >= opens(112));

console.log("\nStage II on Stage I's last day — it appears");
const onLastDay = Date.parse("2026-11-27T00:00:00Z");
const e = entry(112, onLastDay);
check("Stage II entry exists at 2026-11-27T00:00Z", e !== null && e.title === "Stage II locks soon");
check("it surfaces as new on the last day (atMs not backdated to the 7-day lead)", (e?.atMs ?? 0) >= onLastDay);
check("24h push still fires (Nov 27 11:00Z is on Stage I's last day)", pushes(112, lockMs(112) - DAY_MS + 60_000));
check("1h push still fires", pushes(112, lockMs(112) - HOUR_MS + 60_000));
check("entry gone once Stage II locks", entry(112, lockMs(112)) === null);

console.log("\nStage I keeps its own reminder");
check("Stage I entry inside its 7-day lead", entry(111, lockMs(111) - 3 * DAY_MS) !== null);

console.log("\nStage III / playoffs once published (discovery overlay shape)");
const sched = { ...SG.lockSchedule, 113: "2026-12-03T10:00:00Z", 114: "2026-12-10T10:00:00Z" };
const wins = { ...SG.matchWindows, 113: { start: "2026-12-03T00:00:00Z", end: "2026-12-07T23:59:59Z" } };
const po = new Set([114, 115, 116]);
check("Stage III gated to Stage II's last day (Dec 1)", stageReminderOpensAtMs(113, sched, wins, po) === Date.parse("2026-12-01T00:00:00Z"));
check("Playoffs gated to Stage III's last day (Dec 7)", stageReminderOpensAtMs(114, sched, wins, po) === Date.parse("2026-12-07T00:00:00Z"));
check("previous stage with a lock but no window ⇒ gate at its lock",
  stageReminderOpensAtMs(112, { 111: "2026-11-24T04:00:00Z", 112: "2026-11-28T11:00:00Z" }, {}, new Set()) ===
    Date.parse("2026-11-24T04:00:00Z"));
check("previous stage with no usable date ⇒ stay quiet (+Infinity)",
  stageReminderOpensAtMs(112, { 111: "not-a-date", 112: "2026-11-28T11:00:00Z" }, {}, new Set()) === Infinity);

console.log("\nCologne (archived) — same rule on its own schedule");
const CG = BASE_EVENTS[26];
const cgIds = playoffSectionIdsFor(CG);
const cgLocks = stageLocksFromSchedule(CG.lockSchedule, CG.sectionNames, cgIds);
for (const sid of Object.keys(cgLocks).map(Number)) {
  const g = stageReminderOpensAtMs(sid, CG.lockSchedule, CG.matchWindows, cgIds);
  check(`Cologne ${cgLocks[sid].name}: gate is before its lock (reminder still reachable)`, g < Date.parse(cgLocks[sid].lockAt));
}

console.log(`\nverify-stage-reminder-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
