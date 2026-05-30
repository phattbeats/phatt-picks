/**
 * M3 read-pipeline verification — offline, against the committed fixtures.
 *
 * Proves the three things the DoD names, without a re-probe (the running app
 * pulls live data; these fixtures are the snapshot):
 *
 *   1. itemid precision (rule #2): the bigint-safe parser keeps 17+ digit
 *      itemids as exact strings, where a bare JSON.parse silently corrupts them.
 *      This is the exact path valve.ts → predictions.ts use on the live read.
 *   2. scoring weights (rule #3): points_per_pick read from cologne-layout.json
 *      equals Swiss 1/2/3 + playoffs 12/10/7, and a perfect tournament = 135.
 *   3. snapshot state: cologne-predictions.json holds 0 picks — normal pre-pick
 *      (handoff §0); the empty render is correct, real picks arrive live.
 *
 * Run:  DATABASE_URL="file:./dev.db" node --env-file=.env scripts/verify-m3-read.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSafeJson } from "../src/lib/bigint.ts";
import { parsePredictions } from "../src/lib/predictions-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) =>
  readFileSync(join(ROOT, "src/fixtures", name), "utf8");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// [1] itemid precision — the rule #2 trap, on a real itemid from the items fixture.
function proveItemidPrecision(): void {
  console.log("\n[1] ITEMID PRECISION — bigint-safe parse keeps 17+ digit itemids exact");
  // A real (sectionid,groupid,index,pickid,itemid) prediction shape; itemid is
  // teamid 115's real itemid from cologne-items.json.
  const raw = `{"result":{"picks":[{"sectionid":105,"groupid":271,"index":0,"pickid":115,"itemid":17293822569791947961}]}}`;
  const safe = parseSafeJson(raw) as { result: { picks: { itemid: unknown }[] } };
  const safeItemid = safe.result.picks[0].itemid;
  check("parseSafeJson yields a string itemid", typeof safeItemid === "string", String(safeItemid));
  check("itemid digits intact (no rounding)", safeItemid === "17293822569791947961", String(safeItemid));

  const naive = JSON.parse(raw) as { result: { picks: { itemid: number }[] } };
  const naiveItemid = naive.result.picks[0].itemid;
  check(
    "JSON.parse WOULD corrupt it (why rule #2 exists)",
    String(naiveItemid) !== "17293822569791947961",
    `JSON.parse→${naiveItemid}`,
  );

  // PHA-847 regression: bigints in ARRAY position must also survive intact.
  // Old regex `:\s*(\d{16,})` only matched object-value position, so array
  // elements after the first (preceded by `,`/`[`, not `:`) got corrupted.
  const arrRaw = `{"ids":[17293822569790899385,17293822569790964921]}`;
  const arr = parseSafeJson(arrRaw) as { ids: unknown[] };
  check(
    "parseSafeJson preserves bigints inside arrays (PHA-847)",
    arr.ids[0] === "17293822569790899385" && arr.ids[1] === "17293822569790964921",
    JSON.stringify(arr.ids),
  );
  const naiveArr = JSON.parse(arrRaw) as { ids: number[] };
  check(
    "JSON.parse WOULD corrupt array bigints",
    String(naiveArr.ids[0]) !== "17293822569790899385" ||
      String(naiveArr.ids[1]) !== "17293822569790964921",
    JSON.stringify(naiveArr.ids),
  );
}

// [2] scoring weights — read from the layout, verified against the fixture.
function proveWeights(): void {
  console.log("\n[2] SCORING WEIGHTS — read from cologne-layout.json (rule #3)");
  const layout = (parseSafeJson(fixture("cologne-layout.json")) as {
    result: { event: number; sections: { sectionid: number; groups: { points_per_pick: number; picks: unknown[] }[] }[] };
  }).result;

  check("event id is 26", layout.event === 26, String(layout.event));

  const weightOf = (sectionid: number) =>
    layout.sections.find((s) => s.sectionid === sectionid)?.groups.map((g) => g.points_per_pick) ?? [];
  check("Stage I  = 1 pt/pick", JSON.stringify(weightOf(105)) === "[1]");
  check("Stage II = 2 pt/pick", JSON.stringify(weightOf(106)) === "[2]");
  check("Stage III= 3 pt/pick", JSON.stringify(weightOf(107)) === "[3]");
  check("Quarterfinals = 12 pt/pick ×4", JSON.stringify(weightOf(108)) === "[12,12,12,12]");
  check("Semifinals    = 10 pt/pick ×2", JSON.stringify(weightOf(109)) === "[10,10]");
  check("Grand Final   = 7 pt/pick", JSON.stringify(weightOf(110)) === "[7]");

  let max = 0;
  for (const s of layout.sections)
    for (const g of s.groups) max += g.picks.length * g.points_per_pick;
  check("perfect tournament = 135 (60 Swiss + 75 playoffs)", max === 135, String(max));
}

// [3] snapshot state — predictions fixture is empty pre-pick (normal).
function provePredictionsSnapshot(): void {
  console.log("\n[3] PREDICTIONS SNAPSHOT — empty pre-pick is normal (handoff §0)");
  const env = parseSafeJson(fixture("cologne-predictions.json")) as { result: { picks?: unknown[] } };
  const picks = env.result.picks ?? [];
  check("committed predictions snapshot has 0 picks", Array.isArray(picks) && picks.length === 0, `len=${picks.length}`);
}

// [4] PHA-853: drop predictions placeholders (Valve returns groupid+index
//     without sectionid/pickid for slots a stage has touched but not filled).
function provePlaceholderDrop(): void {
  console.log("\n[4] PLACEHOLDER DROP (PHA-853) — slots with missing sectionid/pickid are filtered, not upserted as NaN");
  const env = {
    result: {
      picks: [
        // Real pick — keeps.
        { sectionid: 105, groupid: 271, index: 0, pickid: 115, itemid: "17293822569791947961" },
        // Valve placeholder for a touched-but-unfilled slot (Brandon's PHA-853 case).
        { groupid: 271, index: 7 } as never,
        { groupid: 271, index: 8 } as never,
        { groupid: 271, index: 9 } as never,
        // Real playoff pick — keeps.
        { sectionid: 108, groupid: 274, index: 0, pickid: 89, itemid: "17293822569790899385" },
      ],
    },
  };
  const out = parsePredictions(env);
  check("only the 2 real picks survive", out.length === 2, `got ${out.length}`);
  check("no NaN sectionId in output",
    out.every((p) => Number.isFinite(p.sectionId)),
    JSON.stringify(out.map((p) => p.sectionId)));
  check("no NaN pickId in output",
    out.every((p) => Number.isFinite(p.pickId)),
    JSON.stringify(out.map((p) => p.pickId)));
  check("real picks pass through unchanged",
    out[0].sectionId === 105 && out[0].pickId === 115 && out[1].sectionId === 108 && out[1].pickId === 89);

  // Sanity: an all-real envelope drops nothing.
  const cleanOut = parsePredictions({
    result: {
      picks: [
        { sectionid: 105, groupid: 271, index: 0, pickid: 115, itemid: "17293822569791947961" },
      ],
    },
  });
  check("clean envelope: nothing dropped", cleanOut.length === 1);
}

console.log("=== phaTT Picks M3 read-pipeline verification ===");
proveItemidPrecision();
proveWeights();
provePredictionsSnapshot();
provePlaceholderDrop();
console.log(`\n${failures === 0 ? "M3 READ CHECKS PASSED" : `M3 READ CHECKS FAILED — ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
