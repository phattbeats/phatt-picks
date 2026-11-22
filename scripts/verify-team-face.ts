/**
 * verify-team-face — PHA-5359: 100 Thieves' face is rain, on every surface.
 *
 * Locks pickid 78 to rain (HLTV 8183) through both portrait rules — the shared
 * teamPortrait (pool card, dossier, team page, bracket champion) and the
 * Singapore wrapped edition's portraitFor — and checks that a pin is the only
 * thing that differs from the unpinned rule (no other team's face moves).
 *
 * Run: node --experimental-strip-types --no-warnings --import ./scripts/register-ts-resolve.mjs scripts/verify-team-face.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEAM_FACE_PINS, TEAM_STATS, pinnedFacePhoto } from "../src/lib/team-stats-core.ts";
import { playoffWrappedEditionFor } from "../src/lib/playoff-wrapped-core.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

const RAIN = "/players/78-8183.webp";

// team-assets.ts imports via the "@/" alias, which plain Node can't resolve here;
// load it through a tiny alias shim only if available, else assert via pin + source.
let teamPortrait: ((pickid: number) => string | null) | null = null;
try {
  ({ teamPortrait } = await import("../src/components/sg/teams/team-assets.ts"));
} catch {
  teamPortrait = null;
}

check("pickid 78 is pinned to HLTV 8183 (rain)", TEAM_FACE_PINS[78] === 8183);
check("pinnedFacePhoto(78) is rain's bodyshot", pinnedFacePhoto(78) === RAIN);
check("rain's bodyshot ships in /public", existsSync(resolve(ROOT, "public", RAIN.slice(1))));
check("rain is not a stand-in", TEAM_STATS[78]?.roster.find((p) => p.photo === RAIN)?.standIn !== true);

const sg = playoffWrappedEditionFor(27);
check("Singapore wrapped portrait for 78 is rain", sg?.portraitFor(78) === RAIN);

if (teamPortrait) {
  check("teamPortrait(78) is rain", teamPortrait(78) === RAIN);
} else {
  console.log("  SKIP  teamPortrait direct import (alias); covered by source check below");
}

// Source guard: both rules consult the pin first.
const assets = readFileSync(resolve(ROOT, "src/components/sg/teams/team-assets.ts"), "utf8");
const wrapped = readFileSync(resolve(ROOT, "src/lib/playoff-wrapped-core.ts"), "utf8");
check("teamPortrait consults pinnedFacePhoto first", /teamPortrait\(pickid: number\)[^{]*\{\s*const pinned = pinnedFacePhoto\(pickid\);\s*if \(pinned\) return pinned;/.test(assets));
check("singaporePortrait consults pinnedFacePhoto first", /singaporePortrait\(pickId: number\)[^{]*\{\s*const pinned = pinnedFacePhoto\(pickId\);\s*if \(pinned\) return pinned;/.test(wrapped));

// No other team is pinned (no other face changes).
const pinned = Object.keys(TEAM_FACE_PINS).map(Number);
check("only 100 Thieves is pinned", pinned.length === 1 && pinned[0] === 78);
for (const id of Object.keys(TEAM_STATS).map(Number)) {
  if (id !== 78 && pinnedFacePhoto(id) !== null) check(`pickid ${id} has no pinned face`, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
