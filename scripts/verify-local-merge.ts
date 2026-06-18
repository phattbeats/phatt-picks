/**
 * verify-local-merge — offline proof for the local → Steam pick claim
 * (PHA-1232). Exercises the pure planning in src/lib/local-merge-core.ts:
 *
 *   1. token extraction   (raw token vs pasted login URL)
 *   2. slot keying        (the Pick unique tuple sans player)
 *   3. merge planning      (move into free slots, never clobber a Steam pick)
 *
 * Run: node scripts/verify-local-merge.ts
 */

import {
  extractLoginToken,
  pickSlotKey,
  planLocalMerge,
  type LocalPickRef,
} from "../src/lib/local-merge-core.ts";

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

console.log("\nlocal-merge-core - token extraction");
check("raw token passes through", extractLoginToken("df936aeb68de") === "df936aeb68de");
check("trims whitespace", extractLoginToken("  abc123  ") === "abc123");
check(
  "extracts t= from full login URL",
  extractLoginToken("http://hotline.phatt.vip/api/auth/token-login?t=df936aeb68de") === "df936aeb68de",
);
check(
  "extracts t= when not first query param",
  extractLoginToken("https://x/y?foo=1&t=tok99") === "tok99",
);
check(
  "stops at next & and decodes",
  extractLoginToken("https://x/y?t=a%2Bb&z=2") === "a+b",
);

console.log("\nlocal-merge-core - slot keying");
check(
  "slot key is the unique tuple",
  pickSlotKey({ eventId: 26, sectionId: 3, groupId: 273, slotIndex: 9 }) === "26:3:273:9",
);
check(
  "different slot -> different key",
  pickSlotKey({ eventId: 26, sectionId: 3, groupId: 273, slotIndex: 9 }) !==
    pickSlotKey({ eventId: 26, sectionId: 3, groupId: 273, slotIndex: 8 }),
);

console.log("\nlocal-merge-core - merge planning");
const local: LocalPickRef[] = [
  { id: "L1", eventId: 26, sectionId: 1, groupId: 100, slotIndex: 0 },
  { id: "L2", eventId: 26, sectionId: 1, groupId: 100, slotIndex: 1 },
  { id: "L3", eventId: 26, sectionId: 2, groupId: 200, slotIndex: 0 },
];

{
  // Empty Steam account: everything moves over.
  const plan = planLocalMerge(local, []);
  check("empty steam -> all reassign", plan.reassign.length === 3 && plan.skipped.length === 0);
  check("empty steam -> ids preserved", JSON.stringify(plan.reassign) === JSON.stringify(["L1", "L2", "L3"]));
}

{
  // Steam already owns L2's slot: it's skipped, the rest move.
  const steam = [pickSlotKey({ eventId: 26, sectionId: 1, groupId: 100, slotIndex: 1 })];
  const plan = planLocalMerge(local, steam);
  check("conflict -> that local pick skipped", plan.skipped.length === 1 && plan.skipped[0] === "L2");
  check("conflict -> others reassign", JSON.stringify(plan.reassign) === JSON.stringify(["L1", "L3"]));
}

{
  // Steam owns every slot: nothing moves.
  const steam = local.map(pickSlotKey);
  const plan = planLocalMerge(local, steam);
  check("full overlap -> nothing reassigned", plan.reassign.length === 0 && plan.skipped.length === 3);
}

{
  // Defensive: two local picks claiming the same slot can't both win
  // (the Pick unique constraint forbids this per player, but guard anyway).
  const dupes: LocalPickRef[] = [
    { id: "D1", eventId: 1, sectionId: 1, groupId: 1, slotIndex: 0 },
    { id: "D2", eventId: 1, sectionId: 1, groupId: 1, slotIndex: 0 },
  ];
  const plan = planLocalMerge(dupes, []);
  check("dup local slot -> only first reassigned", plan.reassign.length === 1 && plan.skipped.length === 1);
}

console.log(`\nlocal-merge-core: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
