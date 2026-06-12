/**
 * verify-picks-guard - offline proof for PHA-845 (POST /api/picks guards).
 *
 * Pure-core check on the two helpers POST /api/picks gates on:
 *   - isStageWritable: open / locked / open-but-resolved
 *   - validatePickAgainstLayout: real slot / unknown slot / ineligible team / clear
 *
 * The committed cologne-layout fixture is all-open (picks_allowed:true on
 * every group), so the locked branches have to be exercised with a synthetic
 * group — the guard would otherwise be invisible until live event time.
 *
 * Run: node --env-file=.env scripts/verify-picks-guard.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageWritable } from "../src/lib/reveal-core.ts";
import { validatePickAgainstLayout } from "../src/lib/layout-core.ts";
import type { Layout, Group } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layoutFixtureJson = JSON.parse(read("src/fixtures/cologne-layout.json")) as {
  result: Layout;
};
const committed: Layout = layoutFixtureJson.result;

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

console.log("\npicks-guard - isStageWritable");

check("open group is writable", isStageWritable({ picks_allowed: true }) === true);
check("locked group is not writable", isStageWritable({ picks_allowed: false }) === false);
check(
  "open group with a resolved outcome is not writable",
  isStageWritable({ picks_allowed: true }, true) === false,
);
check(
  "explicit hasResolvedOutcome=false on open group still writable",
  isStageWritable({ picks_allowed: true }, false) === true,
);

console.log("\npicks-guard - validatePickAgainstLayout (vs committed fixture)");

// Sanity: the committed fixture is all-open. The 409 lock branch is covered
// by POST integration, not here — this script proves the layout-shape branch.
const allGroups: Group[] = committed.sections.flatMap((s) => s.groups);
check("fixture has groups", allGroups.length > 0);
check(
  "every group in committed fixture is open (guard would otherwise be invisible)",
  allGroups.every((g) => g.picks_allowed === true),
);

// (105, 271) is a real (section, group). Slot 0 exists; team 115 is eligible.
check(
  "real pick (105, 271, 0, 115) accepted",
  validatePickAgainstLayout(committed, 105, 271, 0, 115) === null,
);
check(
  "clear pick (105, 271, 0, 0) accepted (pickId 0 = TBD, no team check)",
  validatePickAgainstLayout(committed, 105, 271, 0, 0) === null,
);
check(
  "unknown slot (105, 271, 99, 115) rejected",
  validatePickAgainstLayout(committed, 105, 271, 99, 115) === "unknown slot 99",
);
check(
  "ineligible team (105, 271, 0, 99999) rejected",
  validatePickAgainstLayout(committed, 105, 271, 0, 99999) ===
    "team 99999 not eligible for group 271",
);
check(
  "unknown section (99999, 271, 0, 115) rejected",
  validatePickAgainstLayout(committed, 99999, 271, 0, 115) === "unknown section 99999",
);
check(
  "unknown group (105, 99999, 0, 115) rejected",
  validatePickAgainstLayout(committed, 105, 99999, 0, 115) ===
    "unknown group 99999 in section 105",
);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
