/**
 * verify-swiss-standings - offline proof for the live Swiss lineup (PHA-898).
 *
 * buildSwissStandings turns the resolved answer key (StageOutcome) + the
 * viewer's picks into a team-by-status lineup. This loads the committed Stage I
 * fixture and proves:
 *   - Pre-clinch (no outcomes): every team is "live", nothing fabricated.
 *   - A team resolved into the 3:0 / advance / 0:3 buckets reports the matching
 *     status, derived through the swiss-bucket convention.
 *   - The viewer's picks are tagged hit / miss / pending against the answer key.
 *   - Summary counts (hits / pending / total, resolved team count) add up.
 *
 * Run: node scripts/verify-swiss-standings.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSwissStandings, confirmPick, isPredictedBucketFull } from "../src/lib/swiss-standings-core.ts";
import type { SwissTeamStatus } from "../src/lib/swiss-standings-core.ts";
import { bucketSwissSlots } from "../src/lib/swiss-bucket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;

const stage1: Section = layout.sections.find((s) => s.sectionid === 105)!;
const group = stage1.groups[0];
const groupId = group.groupid;
const teamIds = group.teams.map((t) => t.pickid).filter((id) => id !== 0);

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

console.log("\nswiss-standings - pre-clinch: every team still in contention");

const empty = buildSwissStandings(stage1, {}, bucketSwissSlots);
check("all 16 teams listed", empty.teams.length === 16 && empty.totalTeams === 16);
check("every team status === live pre-clinch", empty.teams.every((t) => t.status === "live"));
check("resolvedTeamCount === 0 pre-clinch", empty.resolvedTeamCount === 0);
check("no fabricated user picks when none supplied", empty.userTotal === 0);

console.log("\nswiss-standings - buckets map to the right status (10-slot Swiss)");

// Slots 0,1 = 3:0 ADVANCED · 2..7 = 3:1/3:2 ADVANCED · 8,9 = 0:3 ELIMINATED.
const t30 = teamIds[0];
const tAdv = teamIds[1];
const tOut = teamIds[2];
const outcomes = {
  [groupId]: {
    0: t30, // 3:0
    2: tAdv, // advanced
    8: tOut, // eliminated
  },
};
const resolved = buildSwissStandings(stage1, outcomes, bucketSwissSlots);
const byId = new Map(resolved.teams.map((t) => [t.pickid, t]));
check("slot 0 winner -> advanced-3-0", byId.get(t30)?.status === "advanced-3-0");
check("slot 2 winner -> advanced", byId.get(tAdv)?.status === "advanced");
check("slot 8 winner -> eliminated", byId.get(tOut)?.status === "eliminated");
check("unresolved teams stay live", byId.get(teamIds[5])?.status === "live");
check("resolvedTeamCount === 3", resolved.resolvedTeamCount === 3);

console.log("\nswiss-standings - viewer picks tagged hit / miss / pending (bucket-aware, PHA-918)");

// Bucket-aware: a pick is a HIT when the team clinched the bucket the viewer
// slotted it into, a MISS when it clinched a DIFFERENT bucket, and PENDING only
// while the team has clinched nothing yet (slot order within a bucket is
// irrelevant — the answer key fills bucket slots in standings order, not the
// viewer's). Viewer predicted: t30 goes 3:0 (correct -> hit); tAdv goes 3:0 but
// it actually clinched the advance bucket (-> miss); teamIds[7] into a 0:3 slot
// while it is still live (-> pending).
const userPicks = {
  [groupId]: {
    0: t30, // t30 clinched 3:0, slotted 3:0 -> hit
    1: tAdv, // tAdv clinched advance, slotted 3:0 -> miss
    9: teamIds[7], // teamIds[7] still live -> pending
  },
};
const withPicks = buildSwissStandings(stage1, outcomes, bucketSwissSlots, userPicks);
const picks = new Map(withPicks.userPicks.map((p) => [p.slotIndex, p]));
check("viewer pick in the bucket the team clinched -> hit", picks.get(0)?.result === "hit");
check("team clinched a DIFFERENT bucket than predicted -> miss", picks.get(1)?.result === "miss");
check("team not yet clinched -> pending", picks.get(9)?.result === "pending");
check("userTotal counts every non-empty pick", withPicks.userTotal === 3);
check("userHits === 1", withPicks.userHits === 1);
check("userPending === 1", withPicks.userPending === 1);
check("the remaining pick is a miss", withPicks.userTotal - withPicks.userHits - withPicks.userPending === 1);
check("picked teams flagged userPicked in the lineup", withPicks.teams.find((t) => t.pickid === t30)?.userPicked === true);
check("unpicked team not flagged", withPicks.teams.find((t) => t.pickid === teamIds[10])?.userPicked === false);

console.log("\nswiss-standings - a miss: viewer's team clinched a different bucket");

// Viewer says teamIds[3] goes 3:0, but the answer key resolves teamIds[3] into
// the 0:3 bucket -> the viewer's 3:0 call for it is a miss (it clinched a
// different, definitive bucket).
const missOutcome = { [groupId]: { 8: teamIds[3] } }; // teamIds[3] clinched 0:3
const missPick = { [groupId]: { 0: teamIds[3] } }; // viewer predicted it for 3:0
const missed = buildSwissStandings(stage1, missOutcome, bucketSwissSlots, missPick);
check("team that clinched a different bucket -> miss", missed.userPicks[0]?.result === "miss");
check("miss counts toward neither hits nor pending", missed.userHits === 0 && missed.userPending === 0);

console.log("\nswiss-standings - pickId 0 (cleared slot) is ignored");

const clearedPick = buildSwissStandings(stage1, {}, bucketSwissSlots, { [groupId]: { 0: 0 } });
check("a cleared (0) pick is not counted", clearedPick.userTotal === 0);

console.log("\nswiss-standings - confirmPick: locked-pick green/red/pending (PHA-902)");

check("predicted 3:0, team still in play -> pending", confirmPick("3:0 ADVANCED", "live") === "pending");
check("no status yet -> pending", confirmPick("3:0 ADVANCED", undefined) === "pending");
check("predicted 3:0, team went 3:0 -> right", confirmPick("3:0 ADVANCED", "advanced-3-0") === "right");
check("predicted 3:0, team only went 3:1 (advanced) -> wrong", confirmPick("3:0 ADVANCED", "advanced") === "wrong");
check("predicted 3:0, team eliminated -> wrong", confirmPick("3:0 ADVANCED", "eliminated") === "wrong");
check("predicted advance, team advanced -> right", confirmPick("3:1 / 3:2 ADVANCED", "advanced") === "right");
check("predicted advance, team went 3:0 -> wrong (different bucket)", confirmPick("3:1 / 3:2 ADVANCED", "advanced-3-0") === "wrong");
check("predicted advance, team eliminated -> wrong", confirmPick("3:1 / 3:2 ADVANCED", "eliminated") === "wrong");
check("predicted 0:3, team eliminated -> right", confirmPick("0:3 ELIMINATED", "eliminated") === "right");
check("predicted 0:3, team advanced -> wrong", confirmPick("0:3 ELIMINATED", "advanced") === "wrong");

console.log("\nswiss-standings - pick'em unwinnable when the bucket fills with others (PHA-902)");

// My pick = team 999, predicted 3:0. The 3:0 bucket holds 2.
const twoOthers3_0: Array<readonly [number, SwissTeamStatus]> = [
  [11, "advanced-3-0"], [12, "advanced-3-0"], [999, "live"], [13, "advanced"],
];
const oneOther3_0: Array<readonly [number, SwissTeamStatus]> = [[11, "advanced-3-0"], [999, "live"]];
check("3:0 bucket full of 2 OTHER teams -> my live 3:0 pick is impossible", isPredictedBucketFull("3:0 ADVANCED", 999, twoOthers3_0, 2) === true);
check("only 1 other in 3:0 -> not full yet", isPredictedBucketFull("3:0 ADVANCED", 999, oneOther3_0, 2) === false);
check("my own team in the bucket is not counted as an 'other'", isPredictedBucketFull("3:0 ADVANCED", 11, twoOthers3_0, 2) === false);
check("confirmPick: live team + bucket full of others -> WRONG (no longer winnable)", confirmPick("3:0 ADVANCED", "live", true) === "wrong");
check("confirmPick: live team + bucket NOT full -> still pending", confirmPick("3:0 ADVANCED", "live", false) === "pending");
check("confirmPick: a team that already clinched ignores the fullness flag (still right)", confirmPick("3:0 ADVANCED", "advanced-3-0", true) === "right");
check("0:3 bucket full of 2 others -> live 0:3 pick impossible", isPredictedBucketFull("0:3 ELIMINATED", 999, [[21, "eliminated"], [22, "eliminated"], [999, "live"]], 2) === true);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
