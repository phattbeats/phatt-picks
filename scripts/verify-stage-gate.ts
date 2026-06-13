/**
 * verify-stage-gate - offline proof for the stage-pickability gate (PHA-895).
 *
 * Valve opens every Swiss stage's Pick'Em window at once, so the gate is driven
 * by `picks_allowed` + whether the stage is seeded (has real, non-TBD teams) —
 * NOT by a sequential "wait for the prior stage to resolve" chain. This script
 * loads the committed cologne-layout fixture and proves:
 *   - Stages I/II/III all open together pre-event (they're seeded + allowed).
 *   - The playoff sections (QF/SF/GF) stay locked while their teams are TBD.
 *   - locked-by-valve takes precedence once a stage's groups close.
 *   - Unknown section ids are denied.
 *
 * Run: node --env-file=.env scripts/verify-stage-gate.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResolvedKeys,
  isStagePickable,
  selectCurrentStageIndex,
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

check("fixture has >=4 sections", layout.sections.length >= 4);
check(
  "every group in committed fixture has picks_allowed:true (pre-event)",
  layout.sections.flatMap((s) => s.groups).every((g) => g.picks_allowed === true),
);

// Stages I, II and III are seeded + allowed -> all open together (Brandon's
// 2026-06-02 report: "Stage 1, 2, and 3 are all active … its open").
const stage1 = isStagePickable(layout, 105);
check("section 105 (Stage I) pickable pre-event", stage1.pickable === true);

const stage2 = isStagePickable(layout, 106);
check("section 106 (Stage II) pickable pre-event (opens with Stage I)", stage2.pickable === true);

const stage3 = isStagePickable(layout, 107);
check(
  "section 107 (Stage III) pickable pre-event (8 seeded teams)",
  stage3.pickable === true,
);

console.log("\nstage-gate - playoff bracket stays locked while teams are TBD");

const qfs = isStagePickable(layout, 108);
check(
  "section 108 (Quarterfinals) locked — teams-not-set (all TBD)",
  qfs.pickable === false && qfs.reason === "teams-not-set",
);

const sfs = isStagePickable(layout, 109);
check(
  "section 109 (Semifinals) locked — teams-not-set (all TBD)",
  sfs.pickable === false && sfs.reason === "teams-not-set",
);

const final = isStagePickable(layout, 110);
check(
  "section 110 (Grand Final) locked — teams-not-set (all TBD)",
  final.pickable === false && final.reason === "teams-not-set",
);

console.log("\nstage-gate - a seeded playoff section opens");

// Seed one team into the Quarterfinals: it should flip to open.
const seededQf: Layout = {
  ...layout,
  sections: layout.sections.map((s) =>
    s.sectionid !== 108
      ? s
      : {
          ...s,
          groups: s.groups.map((g, gi) =>
            gi !== 0
              ? g
              : {
                  ...g,
                  teams: g.teams.map((t, ti) => (ti === 0 ? { ...t, pickid: 89 } : t)),
                },
          ),
        },
  ),
};
const qfSeeded = isStagePickable(seededQf, 108);
check("Quarterfinals open once at least one team is seeded", qfSeeded.pickable === true);

console.log("\nstage-gate - locked-by-valve takes precedence over seeding");

// Flip Stage II's groups to picks_allowed:false -> locked-by-valve even though
// the stage is fully seeded.
const valveLocked: Layout = {
  ...layout,
  sections: layout.sections.map((s) =>
    s.sectionid !== 106
      ? s
      : { ...s, groups: s.groups.map((g) => ({ ...g, picks_allowed: false })) },
  ),
};
const stage2ValveLocked = isStagePickable(valveLocked, 106);
check(
  "Stage II reports locked-by-valve when its groups close",
  stage2ValveLocked.pickable === false && stage2ValveLocked.reason === "locked-by-valve",
);

console.log("\nstage-gate - schedule lock (PHA-898): a stage that has begun is locked");

// Stage I is seeded + all-open in the fixture, so it's pickable by default;
// once its published lock time has passed the caller flags lockedByTime and the
// gate reports locked-time-passed against the very same fixture.
const stage1Open = isStagePickable(layout, 105, { lockedByTime: false });
check(
  "Stage I still pickable when its lock time has NOT passed",
  stage1Open.pickable === true,
);
const stage1Begun = isStagePickable(layout, 105, { lockedByTime: true });
check(
  "Stage I reports locked-time-passed once its lock time passes (all-open fixture)",
  stage1Begun.pickable === false && stage1Begun.reason === "locked-time-passed",
);
// Time-lock takes precedence over the live picks_allowed flag.
const stage2BothLocked = isStagePickable(valveLocked, 106, { lockedByTime: true });
check(
  "locked-time-passed takes precedence over locked-by-valve",
  stage2BothLocked.pickable === false && stage2BothLocked.reason === "locked-time-passed",
);
// A future-locked sibling stage stays open while Stage I is locked.
const stage2StillOpen = isStagePickable(layout, 106, { lockedByTime: false });
check(
  "Stage II stays open while Stage I is locked (per-stage, not a chain)",
  stage2StillOpen.pickable === true,
);

console.log("\nstage-gate - unknown section id is denied");

const unknown = isStagePickable(layout, 999);
check(
  "unknown section id reports unknown-section (defensive deny)",
  unknown.pickable === false && unknown.reason === "unknown-section",
);

console.log("\nstage-gate - current-stage selection: dashboard hero + picks-nav default (PHA-1007 / PHA-1050)");

// Statuses below mirror layout.sections order: I, II, III, QF, SF, GF.
const open = { pickable: true, reason: "open" } as const;
const began = { pickable: false, reason: "locked-time-passed" } as const;
const valve = { pickable: false, reason: "locked-by-valve" } as const;
const tbd = { pickable: false, reason: "teams-not-set" } as const;

check(
  "pre-event: first open stage wins (Stage I)",
  selectCurrentStageIndex([open, open, open, tbd, tbd, tbd]) === 0,
);
check(
  "Stage I underway: next open window wins (Stage II)",
  selectCurrentStageIndex([began, open, open, tbd, tbd, tbd]) === 1,
);
check(
  "REGRESSION: all Swiss locked + playoffs unseeded -> Stage III in progress, NOT the Grand Final",
  selectCurrentStageIndex([began, began, began, tbd, tbd, tbd]) === 2,
);
check(
  "playoffs seeded mid-Stage-III: the genuinely open QF window wins",
  selectCurrentStageIndex([began, began, began, open, tbd, tbd]) === 3,
);
check(
  "locked-by-valve also counts as in progress (latest wins)",
  selectCurrentStageIndex([valve, valve, began, tbd, tbd, tbd]) === 2,
);
check(
  "post-event, everything closed: latest started stage (Grand Final)",
  selectCurrentStageIndex([began, began, began, began, began, began]) === 5,
);
check(
  "defensive: nothing open or started -> last section",
  selectCurrentStageIndex([tbd, tbd, tbd, tbd, tbd, tbd]) === 5,
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
