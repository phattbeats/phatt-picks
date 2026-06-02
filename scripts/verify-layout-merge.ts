/**
 * verify-layout-merge — offline proof for the live-layout overlay (PHA-896).
 *
 * The picks UI read the committed fixture and never merged live team data, so
 * Stage III showed 8 of 16 teams and the playoff bracket stayed all-TBD (locked
 * forever as `teams-not-set`). mergeLiveLayout overlays the live `group.teams` +
 * `picks_allowed` onto the fixture. This script synthesizes a live payload from
 * the fixture and proves:
 *   - Stage III's TBD slots get seeded → stage becomes pickable + pool fills.
 *   - The playoff bracket gets seeded → QF/SF/GF become pickable.
 *   - A live `picks_allowed:false` flips a stage to locked-by-valve.
 *   - A null / empty / all-TBD live group degrades to the fixture (no blanking).
 *   - Live-only team defs are unioned into top-level teams.
 *
 * Run: node --env-file=.env scripts/verify-layout-merge.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeLiveLayout } from "../src/lib/layout-merge-core.ts";
import { isStagePickable } from "../src/lib/stage-gate-core.ts";
import { validatePickAgainstLayout } from "../src/lib/layout-core.ts";
import type { Layout } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const fixture = (JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }).result;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name);
  }
}

const STAGE3 = 107;
const QF = 108;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const sec = (l: Layout, id: number) => l.sections.find((s) => s.sectionid === id)!;
const realCount = (l: Layout, id: number) =>
  sec(l, id).groups.flatMap((g) => g.teams).filter((t) => t.pickid !== 0).length;

// --- Baseline: the bug, straight from the fixture ---------------------------
check("fixture Stage III has 8 of 16 teams (the bug)", realCount(fixture, STAGE3) === 8);
check("fixture QF has 0 teams (the bug)", realCount(fixture, QF) === 0);
check(
  "fixture QF is locked teams-not-set",
  isStagePickable(fixture, QF).reason === "teams-not-set",
);

// --- Build a 'live' payload that seeds the advancers + the bracket ----------
const live = clone(fixture);
// Seed Stage III's 8 TBD slots with real (fictional) advancer pickids 9001..9008.
let next = 9001;
for (const g of sec(live, STAGE3).groups) {
  for (const t of g.teams) if (t.pickid === 0) t.pickid = next++;
}
// Seed the QF bracket from the same pool.
for (const g of sec(live, QF).groups) {
  for (const t of g.teams) if (t.pickid === 0) t.pickid = next++;
}
// A live-only team def the fixture never carried.
live.teams.push({ pickid: 9001, logo: "advancer-a", name: "Advancer A" });

const merged = mergeLiveLayout(fixture, live);

check("merged Stage III now has all 16 teams", realCount(merged, STAGE3) === 16);
check("merged Stage III is pickable", isStagePickable(merged, STAGE3).reason === "open");
check("merged QF now has 8 teams", realCount(merged, QF) === 8);
check("merged QF is pickable (no longer teams-not-set)", isStagePickable(merged, QF).reason === "open");

// Eligibility set (write path) now admits a seeded advancer that the fixture rejected.
const s3group = sec(fixture, STAGE3).groups[0];
const advancer = 9001;
check(
  "fixture rejects a Stage III advancer pick (empty eligibility — the 400)",
  validatePickAgainstLayout(fixture, STAGE3, s3group.groupid, s3group.picks[0].index, advancer) !== null,
);
const mGroup = sec(merged, STAGE3).groups[0];
check(
  "merged admits the same Stage III advancer pick",
  validatePickAgainstLayout(merged, STAGE3, mGroup.groupid, mGroup.picks[0].index, advancer) === null,
);

// Top-level team def union — the live-only logo/name resolves.
check(
  "live-only team def is unioned into top-level teams",
  merged.teams.some((t) => t.pickid === 9001 && t.name === "Advancer A"),
);

// --- picks_allowed tracks live ----------------------------------------------
const closed = clone(live);
for (const g of sec(closed, STAGE3).groups) g.picks_allowed = false;
const mergedClosed = mergeLiveLayout(fixture, closed);
check(
  "live picks_allowed:false flips Stage III to locked-by-valve",
  isStagePickable(mergedClosed, STAGE3).reason === "locked-by-valve",
);

// --- Defensive: a degenerate live payload never blanks the fixture ----------
check("null live → fixture verbatim (cold cache)", realCount(mergeLiveLayout(fixture, null), STAGE3) === 8);

const allTbd = clone(fixture); // QF is already all-TBD; assert it doesn't erase anything
check(
  "all-TBD live group leaves fixture untouched",
  realCount(mergeLiveLayout(fixture, allTbd), STAGE3) === 8,
);

const emptyGroups = clone(live);
for (const g of sec(emptyGroups, STAGE3).groups) g.teams = [];
check(
  "empty live teams array does not blank the fixture-seeded Stage III",
  realCount(mergeLiveLayout(fixture, emptyGroups), STAGE3) === 8,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
