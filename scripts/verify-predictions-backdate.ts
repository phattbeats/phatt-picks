/**
 * verify-predictions-backdate - locks in the mid-major Steam backdate (PHA-987).
 *
 * The product promise: a Steam user who joins AFTER a stage has already locked,
 * and connects their auth code, gets their OFFICIAL Valve picks pulled in — even
 * for the locked stages — and the points they earned are backdated. That promise
 * holds by construction across two layers, and this script guards both so a
 * future "helpful" lock filter can't silently break it:
 *
 *   1. PARSE (predictions-core.parsePredictions): imports EVERY pick Valve
 *      returns, across all sections, with no stage/lock filtering.
 *   2. MIRROR (predictions-sync.mirrorPlayerPredictions): upserts every parsed
 *      pick with no lock-time / match-window gate — its only skip is an
 *      archived (frozen) event.
 *
 * Backdating itself needs no rescore job: scoring is live-derived from picks ×
 * outcomes on every render (verify-m4-scoring / verify-live-leaderboard), so the
 * instant the locked-stage picks land they score.
 *
 * Run: node scripts/verify-predictions-backdate.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePredictions,
  type PredictionsEnvelope,
} from "../src/lib/predictions-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

console.log("\nbackdate - parse imports every stage, locked or not");

// A late-joining Steam user's Valve response carries their picks for ALL three
// Swiss stages — including ones that locked before they ever opened the app.
// Stage I (105) and Stage II (106) are "already locked"; Stage III (107) is open.
const sectionByGroup = new Map<number, number>([
  [271, 105], // Stage I group
  [281, 106], // Stage II group
  [291, 107], // Stage III group
]);
const envelope: PredictionsEnvelope = {
  result: {
    picks: [
      { groupid: 271, index: 0, pick: 4608, itemid: "100000000000001" }, // locked Stage I
      { groupid: 271, index: 1, pick: 4494, itemid: "100000000000002" }, // locked Stage I
      { groupid: 281, index: 0, pick: 6665, itemid: "100000000000003" }, // locked Stage II
      { groupid: 291, index: 0, pick: 9565, itemid: "100000000000004" }, // open Stage III
    ],
  },
};

const parsed = parsePredictions(envelope, sectionByGroup);
check("all 4 picks imported — nothing dropped by stage", parsed.length === 4);
check(
  "locked Stage I picks survive the parse",
  parsed.filter((p) => p.sectionId === 105).length === 2,
);
check(
  "locked Stage II pick survives the parse",
  parsed.some((p) => p.sectionId === 106 && p.pickId === 6665),
);
check(
  "open Stage III pick survives the parse",
  parsed.some((p) => p.sectionId === 107 && p.pickId === 9565),
);
check(
  "itemIds carried through as strings (rule #2)",
  parsed.every((p) => typeof p.itemId === "string" && /^\d+$/.test(p.itemId as string)),
);

console.log("\nbackdate - the mirror has no lock gate (source guard)");

// Static guard on the mirror: importing predictions must never become gated on
// the lock schedule or match windows. Those would refuse to write a late
// joiner's already-locked picks — exactly the backdate the product promises.
const mirrorSrc = read("src/lib/predictions-sync.ts");

check(
  "mirror does not import lock-schedule-core",
  !/from\s+["']@?\/?.*lock-schedule-core/.test(mirrorSrc),
);
check(
  "mirror does not call isLockTimePassed",
  !/isLockTimePassed/.test(mirrorSrc),
);
check(
  "mirror does not gate on match windows (isWithinMatchWindow / isWithinAnyMatchWindow)",
  !/isWithinMatchWindow|isWithinAnyMatchWindow/.test(mirrorSrc),
);
check(
  "mirror's only skip beyond auth is an archived/frozen event",
  /isEventFrozenById/.test(mirrorSrc) && /skipped:\s*"event-archived"/.test(mirrorSrc),
);
check(
  "mirror upserts parsed picks (write path intact)",
  /prisma\.pick\.upsert/.test(mirrorSrc),
);

console.log("\n" + pass + "/" + (pass + fail) + " checks passed");
process.exit(fail === 0 ? 0 : 1);
