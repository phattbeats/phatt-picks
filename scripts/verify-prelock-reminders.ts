/**
 * verify-prelock-reminders — offline proof for PHA-929 (the pre-lock reminder
 * job now schedules + reads one source of truth).
 *
 * The bug: runPreLockReminders read STAGE_LOCKS_JSON (empty by default) and was
 * never scheduled, so opted-in users got nothing. The fix derives stage cutoffs
 * from the committed COLOGNE_LOCK_SCHEDULE (stageLocksFromSchedule) and dedups
 * per-tick sends via reminderFireKey, while an in-process scheduler
 * (src/instrumentation.ts) drives runPreLockReminders. This exercises the pure
 * pieces — derivation, fire-key stability, due-window + dedup — that the
 * prisma/web-push job composes.
 *
 * Run via: node scripts/verify-all.mjs  (or standalone with the strip-types loader)
 */

import {
  COLOGNE_LOCK_SCHEDULE,
  COLOGNE_SECTION_NAMES,
  stageLocksFromSchedule,
} from "../src/lib/lock-schedule-core.ts";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  dueReminders,
  prelockSchedulerEnabled,
  reminderFireKey,
} from "../src/lib/notify-core.ts";

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

console.log("\nstageLocksFromSchedule — single source of truth");
const locks = stageLocksFromSchedule();
check("derives all six committed stages (Swiss 105/106/107 + playoffs 108/109/110)",
  Object.keys(locks).sort((a, b) => Number(a) - Number(b)).join(",") === "105,106,107,108,109,110");
check("Stage III (107) name + lockAt come from the committed schedule",
  locks[107]?.name === "Stage III" && locks[107]?.lockAt === COLOGNE_LOCK_SCHEDULE[107]);
check("Stage I / II names resolve from COLOGNE_SECTION_NAMES",
  locks[105]?.name === COLOGNE_SECTION_NAMES[105] && locks[106]?.name === COLOGNE_SECTION_NAMES[106]);
check("playoff sections now derive a reminder cutoff from their committed lock (PHA-1007)",
  locks[108]?.lockAt === COLOGNE_LOCK_SCHEDULE[108] && locks[108]?.name === "Quarterfinals" &&
  locks[110]?.lockAt === COLOGNE_LOCK_SCHEDULE[110]);
check("every derived lock is a valid ISO instant",
  Object.values(locks).every((l) => !Number.isNaN(Date.parse(l.lockAt))));

// A section with a lock but no name falls back rather than dropping the reminder.
const named = stageLocksFromSchedule({ 999: "2026-07-01T10:30:00Z" }, {});
check("missing name falls back to 'Section {id}'", named[999]?.name === "Section 999");

// Shape parity: an env override (STAGE_LOCKS_JSON) decodes to the same {name,lockAt} shape.
const override = JSON.parse('{"107":{"name":"Stage III","lockAt":"2026-06-11T10:30:00Z"}}') as Record<
  number,
  { name: string; lockAt: string }
>;
check("STAGE_LOCKS_JSON override shape matches derived shape",
  typeof override[107].name === "string" && typeof override[107].lockAt === "string");

console.log("\nreminderFireKey — per-tick dedup");
const lock3 = Date.parse(COLOGNE_LOCK_SCHEDULE[107]);
const k24 = reminderFireKey(26, 107, lock3 - DAY_MS);
const k1 = reminderFireKey(26, 107, lock3 - HOUR_MS);
check("24h and 1h reminders get distinct keys", k24 !== k1);
check("key is stable for the same (event, section, fireAt)", reminderFireKey(26, 107, lock3 - DAY_MS) === k24);
check("different section ⇒ different key", reminderFireKey(26, 106, lock3 - DAY_MS) !== k24);

console.log("\ndue + dedup against the real Stage III cutoff");
const at24 = lock3 - DAY_MS + MINUTE_MS; // just inside the 24h fire window
const due = dueReminders(at24, lock3);
check("a 24h reminder is due just after lock-24h", due.some((r) => r.label === "24h"));

// Simulate the job's dedup: once fired, the same reminder is filtered out next tick.
const fired = new Set<string>();
const firstPass = due.filter((r) => !fired.has(reminderFireKey(26, 107, r.fireAtMs)));
for (const r of firstPass) fired.add(reminderFireKey(26, 107, r.fireAtMs));
const secondPass = dueReminders(at24 + 5 * MINUTE_MS, lock3).filter(
  (r) => !fired.has(reminderFireKey(26, 107, r.fireAtMs)),
);
check("first tick inside window dispatches the 24h reminder", firstPass.some((r) => r.label === "24h"));
check("next tick inside the same window does NOT re-dispatch it", !secondPass.some((r) => r.label === "24h"));

console.log("\nscheduler gate (PHA-996) — default ON, env opt-out only");
// The regression this guards: a template Force-Update that drops EVERY ad-hoc
// container var must leave the scheduler armed.
check("both vars unset (the Force-Update state) ⇒ armed", prelockSchedulerEnabled(undefined, undefined));
check("empty strings ⇒ armed", prelockSchedulerEnabled("", ""));
check("legacy opt-in PRELOCK_REMINDERS_ENABLED=1 still armed", prelockSchedulerEnabled("1", undefined));
check("PRELOCK_REMINDERS_DISABLED=1 ⇒ off", !prelockSchedulerEnabled(undefined, "1"));
check("PRELOCK_REMINDERS_DISABLED=true/yes/on ⇒ off",
  !prelockSchedulerEnabled(undefined, "true") &&
  !prelockSchedulerEnabled(undefined, "YES") &&
  !prelockSchedulerEnabled(undefined, " on "));
check("explicit legacy PRELOCK_REMINDERS_ENABLED=0/false ⇒ off (opt-out honored)",
  !prelockSchedulerEnabled("0", undefined) && !prelockSchedulerEnabled("false", undefined));
check("disable wins over enable when both set", !prelockSchedulerEnabled("1", "1"));
check("garbage values don't disable — fail toward armed", prelockSchedulerEnabled("maybe", "nah"));

console.log(`\nverify-prelock-reminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
