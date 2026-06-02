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

console.log("\nstage-gate - unknown section id is denied");

const unknown = isStagePickable(layout, 999);
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
