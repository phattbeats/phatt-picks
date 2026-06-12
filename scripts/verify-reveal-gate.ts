/**
 * verify-reveal-gate - offline proof for PHA-862 (reveal gate keyed by
 * section+group, not groupId alone).
 *
 * The pick-reveal gate in the players + compare pages builds a
 * `groupHasOutcome` Set of resolved groups and reveals a group's picks when it
 * is present. PHA-862: that Set must be keyed by `${sectionId}:${groupId}`, not
 * groupId alone. Keying on groupId alone leaks secrecy if Valve ever reuses a
 * groupid across sections — resolving one section's group would prematurely
 * reveal another section's still-open picks (the exact leak reveal-core /
 * PHA-845 exist to prevent). Cologne groupids (271–280) are globally unique so
 * this is not live today; the gate is defensive.
 *
 * This proves the composite key isolates sections by replaying the page gate
 * logic against a synthetic two-section layout that reuses one groupid.
 *
 * Run: node scripts/verify-reveal-gate.ts
 */

import { arePicksRevealed, groupOutcomeKey, isStageLocked, isStageWritable } from "../src/lib/reveal-core.ts";

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

console.log("\nreveal-gate - composite key shape");

check("groupOutcomeKey is `${sectionId}:${groupId}`", groupOutcomeKey(1, 271) === "1:271");
check(
  "same groupId in different sections -> distinct keys",
  groupOutcomeKey(1, 271) !== groupOutcomeKey(2, 271),
);

console.log("\nreveal-gate - groupid reused across two open sections");

// Two sections that (hypothetically) share groupid 271. Section A's group is
// LOCKED with a resolved outcome; section B's group is still OPEN (picks_allowed).
const REUSED_GROUPID = 271;
const sectionA = { sectionid: 1, group: { groupid: REUSED_GROUPID, picks_allowed: false } };
const sectionB = { sectionid: 2, group: { groupid: REUSED_GROUPID, picks_allowed: true } };

// Build the gate Set exactly as the pages do: only section A has a resolved row.
const groupHasOutcome = new Set<string>();
groupHasOutcome.add(groupOutcomeKey(sectionA.sectionid, sectionA.group.groupid));

// Section A (locked + resolved) reveals.
const revealedA = arePicksRevealed(
  sectionA.group,
  groupHasOutcome.has(groupOutcomeKey(sectionA.sectionid, sectionA.group.groupid)),
);
check("section A (locked, resolved) -> revealed", revealedA === true);

// Section B (open, no resolved row of its own) must stay hidden even though it
// shares the groupid with section A. THIS is the leak PHA-862 closes.
const hasOutcomeB = groupHasOutcome.has(
  groupOutcomeKey(sectionB.sectionid, sectionB.group.groupid),
);
check("section B's composite key is NOT in the resolved set", hasOutcomeB === false);
const revealedB = arePicksRevealed(sectionB.group, hasOutcomeB);
check("section B (open, unresolved, shared groupid) -> still hidden", revealedB === false);

// Regression-guard: the OLD groupId-only gate would have leaked. Prove a
// groupId-keyed set reveals B, so the composite key is doing real work.
const legacyGroupOnly = new Set<number>([sectionA.group.groupid]);
const legacyLeak = arePicksRevealed(
  sectionB.group,
  legacyGroupOnly.has(sectionB.group.groupid),
);
check("groupId-only gate WOULD have leaked section B (proves the fix matters)", legacyLeak === true);

console.log("\nreveal-gate - compare-page pick map must be section-qualified too");

// The compare page renders each revealed group's picks from a per-player pick
// map. If that map is keyed by groupId ALONE, a reused groupid collides: player
// A's section-1 and section-2 picks for groupid 271 overwrite each other, so a
// revealed (locked) section-1 could surface section-2's still-secret pick. The
// map MUST be section-qualified (sectionId -> groupId -> slotIndex -> pickId),
// matching scoring's toPlayerPickMap.
const playerPicks = [
  { sectionId: 1, groupId: REUSED_GROUPID, slotIndex: 0, pickId: 1001 }, // section 1 (locked)
  { sectionId: 2, groupId: REUSED_GROUPID, slotIndex: 0, pickId: 2002 }, // section 2 (open, secret)
];

// Legacy groupId-only map (the bug): last write wins -> collision.
const legacyPickMap: Record<number, Record<number, number>> = {};
for (const p of playerPicks) {
  legacyPickMap[p.groupId] ??= {};
  legacyPickMap[p.groupId][p.slotIndex] = p.pickId;
}
check(
  "groupId-only pick map COLLIDES (section 1 lookup leaks section 2's secret pick)",
  legacyPickMap[REUSED_GROUPID][0] === 2002,
);

// Section-qualified map (the fix): the two sections stay distinct.
const sectionPickMap: Record<number, Record<number, Record<number, number>>> = {};
for (const p of playerPicks) {
  sectionPickMap[p.sectionId] ??= {};
  sectionPickMap[p.sectionId][p.groupId] ??= {};
  sectionPickMap[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
}
check(
  "section-qualified pick map keeps section 1's pick intact",
  sectionPickMap[1][REUSED_GROUPID][0] === 1001,
);
check(
  "section-qualified pick map keeps section 2's pick separate",
  sectionPickMap[2][REUSED_GROUPID][0] === 2002,
);

console.log("\nreveal-gate - schedule lock reveals a started stage (PHA-898)");

// The Compare/players pages showed "Picks hidden until this stage locks" for a
// stage that had BEGUN (Brandon's report): the committed fixture is all-open
// (picks_allowed:true) and no outcome row had landed yet, so the old 2-arg gate
// kept it hidden. With the lockedByTime signal, a started stage reveals.
const openGroup = { groupid: 271, picks_allowed: true };
check(
  "open + no outcome + not-yet-locked-by-time -> hidden",
  arePicksRevealed(openGroup, false, false) === false,
);
check(
  "open + no outcome + lock time PASSED -> revealed (the Compare fix)",
  arePicksRevealed(openGroup, false, true) === true,
);
check(
  "isStageLocked agrees: lockedByTime closes the window",
  isStageLocked(openGroup, false, true) === true,
);

console.log("\nreveal-gate - INVARIANT: revealed === !writable across all input combos");

// The three gate fns must be exact inverses so adding lockedByTime can never
// create a leak (revealed while writable) or a dead zone (hidden AND not
// writable — exactly what Brandon hit). Exhaustively check the truth table.
let invariantHolds = true;
const dead: string[] = [];
for (const picks_allowed of [true, false]) {
  for (const outcome of [false, true]) {
    for (const byTime of [false, true]) {
      const g = { groupid: 271, picks_allowed };
      const revealed = arePicksRevealed(g, outcome, byTime);
      const writable = isStageWritable(g, outcome, byTime);
      if (revealed === writable) {
        invariantHolds = false;
        dead.push(`picks_allowed=${picks_allowed} outcome=${outcome} byTime=${byTime}: revealed=${revealed} writable=${writable}`);
      }
    }
  }
}
check("revealed === !writable for all 8 input combinations (no leak, no dead zone)", invariantHolds);
if (!invariantHolds) for (const d of dead) console.error("    VIOLATION: " + d);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
