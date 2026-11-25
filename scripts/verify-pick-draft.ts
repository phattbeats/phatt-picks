/**
 * verify-pick-draft — offline proof for the browser-saved pick draft
 * (PHA-5268, src/lib/pick-draft-core.ts).
 *
 * Run: node scripts/verify-all.mjs   (or this file under the resolver hook)
 */

import {
  classifySaveFailure,
  diffSlots,
  draftStorageKey,
  flatten,
  mergeDraft,
  readDraft,
  retryDelayMs,
  unflatten,
  DRAFT_MAX_AGE_MS,
} from "../src/lib/pick-draft-core.ts";

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
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("flatten / unflatten");
check("round-trips, drops empty", eq(flatten({ 5: { 0: 10, 1: 0, 2: 12 } }), { "5:0": 10, "5:2": 12 }));
check("unflatten nests", eq(unflatten({ "5:0": 10, "6:1": 3 }), { 5: { 0: 10 }, 6: { 1: 3 } }));
check("unflatten ignores junk keys", eq(unflatten({ nope: 1, "5:0": 0 }), {}));

console.log("diffSlots");
check("missing = 0", eq(diffSlots({ "1:0": 4 }, {}), ["1:0"]));
check("cleared slot shows", eq(diffSlots({}, { "1:0": 4 }), ["1:0"]));
check("equal = none", diffSlots({ "1:0": 4 }, { "1:0": 4 }).length === 0);

console.log("mergeDraft");
// Player placed team 7 in slot 3 offline; server unchanged since.
check(
  "pending edit restored over unchanged server",
  eq(mergeDraft({ "1:0": 4 }, { base: { "1:0": 4 }, picks: { "1:0": 4, "1:3": 7 } }), { "1:0": 4, "1:3": 7 }),
);
// Valve mirror changed slot 0 after the draft; player only touched slot 3.
check(
  "server wins on slots the player didn't touch",
  eq(mergeDraft({ "1:0": 9 }, { base: { "1:0": 4 }, picks: { "1:0": 4, "1:3": 7 } }), { "1:0": 9, "1:3": 7 }),
);
check(
  "pending clear stays cleared",
  eq(mergeDraft({ "1:0": 4, "1:1": 5 }, { base: { "1:0": 4, "1:1": 5 }, picks: { "1:0": 4 } }), { "1:0": 4 }),
);
// Server put team 7 in slot 0 meanwhile; the local edit put 7 in slot 3.
check(
  "collision: local edit keeps the team, server copy cleared",
  eq(mergeDraft({ "1:0": 7 }, { base: {}, picks: { "1:3": 7 } }), { "1:3": 7 }),
);
check(
  "same team in different groups is fine",
  eq(mergeDraft({ "1:0": 7 }, { base: {}, picks: { "2:0": 7 } }), { "1:0": 7, "2:0": 7 }),
);
check("no pending = server as-is", eq(mergeDraft({ "1:0": 7 }, { base: { "1:0": 3 }, picks: { "1:0": 3 } }), { "1:0": 7 }));
check("incomplete board survives merge", Object.keys(mergeDraft({}, { base: {}, picks: { "1:0": 1, "1:4": 2 } })).length === 2);

console.log("classifySaveFailure");
check("network → retry", classifySaveFailure(null) === "retry");
check("500 → retry", classifySaveFailure(500) === "retry");
check("502 → retry", classifySaveFailure(502) === "retry");
check("401 (session lapsed) → retry", classifySaveFailure(401) === "retry");
check("429 → retry", classifySaveFailure(429) === "retry");
check("409 stage_locked → drop", classifySaveFailure(409) === "drop");
check("400 invalid → drop", classifySaveFailure(400) === "drop");

console.log("retryDelayMs");
check("2s, 4s, 8s", retryDelayMs(1) === 2000 && retryDelayMs(2) === 4000 && retryDelayMs(3) === 8000);
check("capped at 60s", retryDelayMs(20) === 60_000);

console.log("readDraft");
const now = 1_800_000_000_000;
const good = JSON.stringify({ v: 1, owner: "p1", base: { "1:0": 4 }, picks: { "1:0": 4, "1:3": 7 }, savedAt: now - 1000 });
check("reads own draft", readDraft(good, "p1", now)?.picks["1:3"] === 7);
check("ignores another player's draft", readDraft(good, "p2", now) === null);
check("ignores when signed out", readDraft(good, "", now) === null);
check("ignores stale draft", readDraft(good, "p1", now + DRAFT_MAX_AGE_MS + 1) === null);
check("ignores malformed JSON", readDraft("{oops", "p1", now) === null);
check("ignores wrong version", readDraft(JSON.stringify({ v: 2, owner: "p1", savedAt: now }), "p1", now) === null);
check(
  "strips bad entries",
  eq(
    readDraft(JSON.stringify({ v: 1, owner: "p1", base: {}, picks: { "1:0": 4, x: 2, "1:1": -3, "1:2": 1.5 }, savedAt: now }), "p1", now)?.picks,
    { "1:0": 4 },
  ),
);
check("storage key scoped by event + unit", draftStorageKey(27, 111) !== draftStorageKey(27, 112) && draftStorageKey(27, "playoff").endsWith(":27:playoff"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
