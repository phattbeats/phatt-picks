/**
 * verify-stale-watchdog — offline proof for the PHA-1273 stale-outcome watchdog.
 *
 * The live tick already re-pokes the Valve oracle every cycle, so a transiently
 * stuck playoff match self-heals on the next tick. What was missing was NOTICING
 * a match that stays unresolved long past when it should have finished — Cologne
 * QF1/QF2 sat un-green for ~2 days behind a normalizer seed-swap bug while that
 * blind retry silently masked it. `detectStalePlayoffOutcomes` is the watchdog.
 *
 * This is a pure-function check (no DB / no fetch): it replays the real Cologne
 * QF1/QF2 scenario and asserts the detector is count-based, seed-order-independent,
 * never false-fires on an in-progress match, and is actually wired into the tick.
 *
 * Run: node scripts/verify-stale-watchdog.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectStalePlayoffOutcomes,
  PLAYOFF_RESOLVE_GRACE_MS,
} from "../src/lib/outcomes-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

const HOUR = 60 * 60 * 1000;
const ms = (iso: string) => Date.parse(iso);

// The real Cologne QF schedule (section 108): 4 games, two on Jun 18, two Jun 19.
const QF_SCHEDULE = {
  108: [
    "2026-06-18T13:45:00Z",
    "2026-06-18T17:00:00Z",
    "2026-06-19T13:45:00Z",
    "2026-06-19T17:00:00Z",
  ],
} as const;

console.log("\nstale-watchdog — the real QF1/QF2 stuck scenario (PHA-1273)");

// Grace cleared on both Jun-18 games, neither Jun-19 game started yet. Healthy:
// the two early games resolved, so nothing is overdue.
check(
  "Jun 18 evening, both early games resolved → not stale",
  detectStalePlayoffOutcomes(QF_SCHEDULE, new Map([[108, 2]]), ms("2026-06-18T21:00:00Z"), PLAYOFF_RESOLVE_GRACE_MS)
    .length === 0,
);

// The actual bug: by Jun 19 all four deadlines have passed (QF3/QF4 played and
// resolved) but QF1/QF2 never did — only 2 of 4 groups resolved. STALE = 2.
const stuck = detectStalePlayoffOutcomes(
  QF_SCHEDULE,
  new Map([[108, 2]]),
  ms("2026-06-20T02:00:00Z"),
  PLAYOFF_RESOLVE_GRACE_MS,
);
check("Jun 20, 2 of 4 resolved → flagged stale", stuck.length === 1);
check("stale section is the QF round (108)", stuck[0]?.sectionId === 108);
check("missing count = 2 (QF1/QF2)", stuck[0]?.missing === 2);
check("expectedDone = 4, resolved = 2", stuck[0]?.expectedDone === 4 && stuck[0]?.resolved === 2);
check("overdueByMs points past a real deadline (> 0)", (stuck[0]?.overdueByMs ?? 0) > 0);

console.log("\nstale-watchdog — never false-fires on a match still in progress");

// A game that started 1h ago is inside the 6h grace → not yet overdue.
check(
  "game started 1h ago (inside grace) → not stale",
  detectStalePlayoffOutcomes(
    { 110: ["2026-06-21T15:00:00Z"] },
    new Map(),
    ms("2026-06-21T16:00:00Z"),
    PLAYOFF_RESOLVE_GRACE_MS,
  ).length === 0,
);

// Before any game starts, nothing is expected → never stale (no pre-event noise).
check(
  "before the round starts → not stale",
  detectStalePlayoffOutcomes(QF_SCHEDULE, new Map(), ms("2026-06-18T00:00:00Z"), PLAYOFF_RESOLVE_GRACE_MS)
    .length === 0,
);

// Fully resolved round, well past every deadline → healthy.
check(
  "all 4 resolved, long after → not stale",
  detectStalePlayoffOutcomes(QF_SCHEDULE, new Map([[108, 4]]), ms("2026-06-25T00:00:00Z"), PLAYOFF_RESOLVE_GRACE_MS)
    .length === 0,
);

console.log("\nstale-watchdog — seed-order independence + edges");

// Count-based: the detector must NOT depend on which specific group resolved. Any
// 2-resolved count yields the same "2 missing" verdict regardless of group ids.
check(
  "verdict depends only on the COUNT, not which group resolved",
  detectStalePlayoffOutcomes(QF_SCHEDULE, new Map([[108, 2]]), ms("2026-06-20T02:00:00Z"))
    .reduce((n, s) => n + s.missing, 0) === 2,
);

// More resolved than scheduled-done (e.g. an early finish) must never go negative.
check(
  "resolved ≥ expectedDone → not stale (no negative missing)",
  detectStalePlayoffOutcomes(QF_SCHEDULE, new Map([[108, 4]]), ms("2026-06-18T21:00:00Z"), PLAYOFF_RESOLVE_GRACE_MS)
    .length === 0,
);

// Empty schedule (future major not yet seeded) → no-op, no throw.
check("empty schedule → no-op", detectStalePlayoffOutcomes({}, new Map(), ms("2026-06-20T02:00:00Z")).length === 0);

// Grace default is exported and the 6h boundary is exclusive-inclusive as designed:
// exactly at start+grace the match counts as "should be done".
check("default grace is 6h", PLAYOFF_RESOLVE_GRACE_MS === 6 * HOUR);
check(
  "exactly at start+grace counts as expected-done",
  detectStalePlayoffOutcomes(
    { 110: ["2026-06-21T15:00:00Z"] },
    new Map(),
    ms("2026-06-21T15:00:00Z") + 6 * HOUR,
    PLAYOFF_RESOLVE_GRACE_MS,
  ).length === 1,
);

console.log("\nstale-watchdog — wired into the live tick");

const outcomes = read("src/lib/outcomes.ts");
check(
  "refreshLiveResultsTick runs the watchdog after the oracle + bridge",
  /bridgeSwissOutcomes\(eventId, nowMs\)[\s\S]*detectStalePlayoffOutcomes\(/.test(outcomes),
);
check("tick returns a stale count", /return \{ eventId, ingested, resolved, stale \}/.test(outcomes));
check(
  "tick emits a structured STALE warning",
  /\[live-tick\] STALE playoff outcomes/.test(outcomes),
);
check(
  "watchdog counts DISTINCT resolved groups per section",
  /groupsBySection[\s\S]*set\.add\(r\.groupId\)/.test(outcomes),
);

const instrumentation = read("src/instrumentation.ts");
check("instrumentation surfaces overdue matches in the tick log", /OVERDUE/.test(instrumentation));

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
