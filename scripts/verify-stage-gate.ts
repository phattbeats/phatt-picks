/**
 * verify-stage-gate - offline proof for PHA-841 (M8.2 stage lock).
 *
 * Loads the committed cologne-layout fixture and exercises isStagePickable
 * across the pre-event, mid-stage-1, mid-stage-2, and locked-by-valve cases.
 * Pre-event: only section 105 (the first) is pickable; everything downstream
 * is gated on "previous-stage-unresolved". Once we synthesize a fully
 * resolved StageOutcome set for the previous stage, the next one unlocks.
 *
 * Run: node --env-file=.env scripts/verify-stage-gate.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResolvedKeys,
  isStagePickable,
} from "../src/lib/stage-gate-core.ts";
import type { Layout } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layoutFixtureJson = JSON.parse(read("src/fixtures/cologne-layout.json")) as {
  result: Layout;
};
const layout: Layout = layoutFixtureJson.result;

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

console.log("\nstage-gate - committed all-open fixture (pre-event)");

// Sanity: confirm the fixture is structured as expected so the assertions
// below stay meaningful if the fixture is ever swapped.
check("fixture has >=4 sections", layout.sections.length >= 4);
check(
  "every group in committed fixture has picks_allowed:true (pre-event)",
  layout.sections.flatMap((s) => s.groups).every((g) => g.picks_allowed === true),
);

const NO_OUTCOMES = new Set<string>();

// Pre-event: stage 1 is pickable, stage 2 / 3 / playoffs are not.
const stage1 = isStagePickable(layout, NO_OUTCOMES, 105);
check("section 105 (Stage I) pickable pre-event", stage1.pickable === true);

const stage2 = isStagePickable(layout, NO_OUTCOMES, 106);
check(
  "section 106 (Stage II) gated by previous-stage-unresolved pre-event",
  stage2.pickable === false && stage2.reason === "previous-stage-unresolved",
);
check(
  "stage 2 lock points at Stage I",
  stage2.pickable === false &&
    stage2.reason === "previous-stage-unresolved" &&
    stage2.previousSectionId === 105 &&
    stage2.previousSectionName === "Stage I",
);

const stage3 = isStagePickable(layout, NO_OUTCOMES, 107);
check(
  "section 107 (Stage III) gated by previous-stage-unresolved pre-event",
  stage3.pickable === false && stage3.reason === "previous-stage-unresolved",
);

const qfs = isStagePickable(layout, NO_OUTCOMES, 108);
check(
  "section 108 (Quarterfinals) gated by previous-stage-unresolved pre-event",
  qfs.pickable === false && qfs.reason === "previous-stage-unresolved",
);

const sfs = isStagePickable(layout, NO_OUTCOMES, 109);
check(
  "section 109 (Semifinals) gated pre-event",
  sfs.pickable === false && sfs.reason === "previous-stage-unresolved",
);

const final = isStagePickable(layout, NO_OUTCOMES, 110);
check(
  "section 110 (Grand Final) gated pre-event",
  final.pickable === false && final.reason === "previous-stage-unresolved",
);

console.log("\nstage-gate - synthetic Stage I fully resolved -> Stage II unlocks");

const stage1Section = layout.sections.find((s) => s.sectionid === 105)!;
const stage1ResolvedRows = stage1Section.groups.flatMap((g) =>
  g.picks.map((p) => ({
    sectionId: stage1Section.sectionid,
    groupId: g.groupid,
    slotIndex: p.index,
  })),
);
const stage1Resolved = buildResolvedKeys(stage1ResolvedRows);

const stage2After = isStagePickable(layout, stage1Resolved, 106);
check("Stage II unlocks once Stage I fully resolved", stage2After.pickable === true);

const stage3StillGated = isStagePickable(layout, stage1Resolved, 107);
check(
  "Stage III still gated (waiting on Stage II)",
  stage3StillGated.pickable === false &&
    stage3StillGated.reason === "previous-stage-unresolved",
);

console.log("\nstage-gate - synthetic Stage I + II resolved -> Stage III unlocks");

const stage2Section = layout.sections.find((s) => s.sectionid === 106)!;
const stage12ResolvedRows = [
  ...stage1ResolvedRows,
  ...stage2Section.groups.flatMap((g) =>
    g.picks.map((p) => ({
      sectionId: stage2Section.sectionid,
      groupId: g.groupid,
      slotIndex: p.index,
    })),
  ),
];
const stage12Resolved = buildResolvedKeys(stage12ResolvedRows);

const stage3After = isStagePickable(layout, stage12Resolved, 107);
check("Stage III unlocks once Stage II fully resolved", stage3After.pickable === true);

const qfsStillGated = isStagePickable(layout, stage12Resolved, 108);
check(
  "Quarterfinals still gated (waiting on Stage III)",
  qfsStillGated.pickable === false && qfsStillGated.reason === "previous-stage-unresolved",
);

console.log("\nstage-gate - partial previous-stage resolution does NOT unlock");

// Drop one slot from Stage I — Stage II must stay locked. Off-by-one safety.
const stage1Partial = new Set(stage1Resolved);
const aSlot = stage1ResolvedRows[0];
stage1Partial.delete(`${aSlot.sectionId}:${aSlot.groupId}:${aSlot.slotIndex}`);
const stage2Partial = isStagePickable(layout, stage1Partial, 106);
check(
  "Stage II stays locked when even one Stage I slot is unresolved",
  stage2Partial.pickable === false &&
    stage2Partial.reason === "previous-stage-unresolved",
);

console.log("\nstage-gate - QF -> SF -> Final bracket chain");

// Fully resolve through QFs. SFs (109) should unlock, Final (110) still gated.
const qfSection = layout.sections.find((s) => s.sectionid === 108)!;
const stage3SectionDef = layout.sections.find((s) => s.sectionid === 107)!;
const throughQfRows = [
  ...stage12ResolvedRows,
  ...stage3SectionDef.groups.flatMap((g) =>
    g.picks.map((p) => ({
      sectionId: stage3SectionDef.sectionid,
      groupId: g.groupid,
      slotIndex: p.index,
    })),
  ),
  ...qfSection.groups.flatMap((g) =>
    g.picks.map((p) => ({
      sectionId: qfSection.sectionid,
      groupId: g.groupid,
      slotIndex: p.index,
    })),
  ),
];
const throughQfResolved = buildResolvedKeys(throughQfRows);

const sfsAfter = isStagePickable(layout, throughQfResolved, 109);
check("Semifinals unlock once QFs resolve", sfsAfter.pickable === true);

const finalAfterQfs = isStagePickable(layout, throughQfResolved, 110);
check(
  "Final still gated (waiting on Semifinals)",
  finalAfterQfs.pickable === false &&
    finalAfterQfs.reason === "previous-stage-unresolved",
);

console.log("\nstage-gate - locked-by-valve takes precedence over upstream resolution");

// Flip Stage II's groups to picks_allowed:false. Even with no upstream resolved,
// the result must be `locked-by-valve` (not `previous-stage-unresolved`).
const valveLocked: Layout = {
  ...layout,
  sections: layout.sections.map((s) =>
    s.sectionid !== 106
      ? s
      : { ...s, groups: s.groups.map((g) => ({ ...g, picks_allowed: false })) },
  ),
};
const stage2ValveLocked = isStagePickable(valveLocked, NO_OUTCOMES, 106);
check(
  "Stage II reports locked-by-valve when its groups close",
  stage2ValveLocked.pickable === false && stage2ValveLocked.reason === "locked-by-valve",
);

console.log("\nstage-gate - unknown section id is denied");

const unknown = isStagePickable(layout, NO_OUTCOMES, 999);
check(
  "unknown section id reports unknown-section (defensive deny)",
  unknown.pickable === false && unknown.reason === "unknown-section",
);

console.log("\nstage-gate - buildResolvedKeys round-trip");

const built = buildResolvedKeys([
  { sectionId: 105, groupId: 271, slotIndex: 0 },
  { sectionId: 105, groupId: 271, slotIndex: 3 },
]);
check("buildResolvedKeys formats keys as `${section}:${group}:${slot}`",
  built.has("105:271:0") && built.has("105:271:3") && built.size === 2,
);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
