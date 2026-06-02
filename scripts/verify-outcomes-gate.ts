/**
 * verify-outcomes-gate - offline proof for PHA-844 (Liquipedia rate-limit fix).
 *
 * Pure-core check: pickLockedUnresolvedSlots() against the COMMITTED
 * cologne-layout fixture (all picks_allowed:true pre-event) must yield zero
 * candidates, so ingestOutcomes makes zero source calls. Then a synthetic
 * layout with one stage flipped to picks_allowed:false must yield that stage's
 * slots, proving the gate actually opens once a stage locks.
 *
 * Run: node --env-file=.env scripts/verify-outcomes-gate.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pickLockedUnresolvedSlots } from "../src/lib/outcomes-core.ts";
import type { Layout, Group, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layoutFixtureJson = JSON.parse(read("src/fixtures/cologne-layout.json")) as {
  result: Layout;
};

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

const committed: Layout = layoutFixtureJson.result;

console.log("\noutcomes-gate - committed all-open fixture (pre-event)");

// Sanity: confirm the fixture really is all-open. If this ever changes the
// test below stops proving what it claims to prove.
const allGroups: Group[] = committed.sections.flatMap((s) => s.groups);
check("fixture has groups", allGroups.length > 0);
check(
  "every group in committed fixture has picks_allowed:true (pre-event)",
  allGroups.every((g) => g.picks_allowed === true),
);

const totalSlots = allGroups.reduce((n, g) => n + g.picks.length, 0);
check("fixture defines >0 total slots", totalSlots > 0);

// Empty StageOutcome set — the live pre-event state.
const empty = new Set<string>();
const lockedUnresolved = pickLockedUnresolvedSlots(committed, empty);
check(
  "ZERO locked-unresolved slots pre-event (no Liquipedia call)",
  lockedUnresolved.length === 0,
);

console.log("\noutcomes-gate - synthetic locked stage (live-event activation)");

// Flip the first group's picks_allowed to false; everything else stays open.
const firstSection: Section = committed.sections[0];
const firstGroup: Group = firstSection.groups[0];

const synthetic: Layout = {
  ...committed,
  sections: committed.sections.map((s) =>
    s.sectionid !== firstSection.sectionid
      ? s
      : {
          ...s,
          groups: s.groups.map((g) =>
            g.groupid !== firstGroup.groupid ? g : { ...g, picks_allowed: false },
          ),
        },
  ),
};

const lockedNoneResolved = pickLockedUnresolvedSlots(synthetic, empty);
check(
  "locked stage with no resolved rows -> selects that stage's slots",
  lockedNoneResolved.length === firstGroup.picks.length,
);
check(
  "selected slots all belong to the locked group",
  lockedNoneResolved.every(
    (s) => s.sectionId === firstSection.sectionid && s.groupId === firstGroup.groupid,
  ),
);

// Same synthetic layout, but pretend every slot in the locked group is already
// resolved — the gate should return empty (the "cache hard" terminal case).
const allResolvedKeys = new Set(
  firstGroup.picks.map(
    (p) => `${firstSection.sectionid}:${firstGroup.groupid}:${p.index}`,
  ),
);
const lockedAllResolved = pickLockedUnresolvedSlots(synthetic, allResolvedKeys);
check(
  "locked stage with all slots already resolved -> zero candidates",
  lockedAllResolved.length === 0,
);

// And: one slot still unresolved -> exactly one candidate.
const keysMinusOne = new Set(allResolvedKeys);
const firstPickKey = `${firstSection.sectionid}:${firstGroup.groupid}:${firstGroup.picks[0].index}`;
keysMinusOne.delete(firstPickKey);
const lockedOneMissing = pickLockedUnresolvedSlots(synthetic, keysMinusOne);
check(
  "locked stage with one slot missing -> exactly one candidate",
  lockedOneMissing.length === 1,
);
check(
  "the one candidate is the missing slot",
  lockedOneMissing[0]?.slotIndex === firstGroup.picks[0].index,
);

console.log("\noutcomes-gate - open stage stays silent regardless of resolved rows");

// Even with phantom "resolved" rows for an open stage (shouldn't happen, but
// defensively): the gate only cares about picks_allowed, so still zero.
const phantomKey = `${firstSection.sectionid}:${firstGroup.groupid}:${firstGroup.picks[0].index}`;
const openWithPhantom = pickLockedUnresolvedSlots(committed, new Set([phantomKey]));
check(
  "open stage + phantom resolved row -> still zero (open stages never queried)",
  openWithPhantom.length === 0,
);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
