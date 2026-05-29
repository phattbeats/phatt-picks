/**
 * verify-m9-4-swiss-bucket — offline proof for PHA-853 Swiss bucket layout.
 *
 * The slot-to-bucket map isn't in the Valve API; it's UI convention that has
 * to stay aligned with what Brandon sees on Valve's pickem page. This script
 * asserts the contract bucketSwissSlots() exposes, and that the convention
 * fully covers a Swiss stage's 10 slots without overlap.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/verify-m9-4-swiss-bucket.ts
 */

import {
  bucketSwissSlots,
  isSwissSection,
} from "../src/lib/swiss-bucket-core.ts";

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

// --- Stage I/II/III: 10-slot bucketing (the canonical case) -------------------

const tens = bucketSwissSlots(10);
check("10 slots → 3 buckets", tens.length === 3);
check("bucket 0 label is 3:0 ADVANCED", tens[0].label === "3:0 ADVANCED");
check("bucket 1 label is 3:1 / 3:2 ADVANCED", tens[1].label === "3:1 / 3:2 ADVANCED");
check("bucket 2 label is 0:3 ELIMINATED", tens[2].label === "0:3 ELIMINATED");
check("bucket 0 has 2 slots", tens[0].slotIndexes.length === 2);
check("bucket 1 has 6 slots", tens[1].slotIndexes.length === 6);
check("bucket 2 has 2 slots", tens[2].slotIndexes.length === 2);

const allIndexes = tens.flatMap((b) => b.slotIndexes);
const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
check(
  "every slot 0..9 appears exactly once across buckets",
  allIndexes.length === expected.length &&
    expected.every((i) => allIndexes.includes(i)) &&
    new Set(allIndexes).size === allIndexes.length,
);
check(
  "slot indexes are contiguous (ascending) within each bucket",
  tens.every((b) =>
    b.slotIndexes.every((v, i) => i === 0 || v === b.slotIndexes[i - 1] + 1),
  ),
);
check(
  "bucket ordering is ascending by first slot",
  tens.every((b, i) => i === 0 || b.slotIndexes[0] > tens[i - 1].slotIndexes[0]),
);

// --- Fallback: anything other than 10 slots collapses to one card -------------

const five = bucketSwissSlots(5);
check("5 slots → single PICKS bucket (defensive fallback)", five.length === 1);
check("fallback covers all slots", five[0].slotIndexes.length === 5);
check("fallback bucket label is PICKS", five[0].label === "PICKS");

const zero = bucketSwissSlots(0);
check("0 slots → single empty PICKS bucket", zero.length === 1);
check("0-slot bucket has 0 indexes", zero[0].slotIndexes.length === 0);

// --- isSwissSection: 105/106/107 only, playoffs and randoms reject -----------

check("section 105 is Swiss", isSwissSection(105));
check("section 106 is Swiss", isSwissSection(106));
check("section 107 is Swiss", isSwissSection(107));
check("section 108 (QF) is NOT Swiss", !isSwissSection(108));
check("section 109 (SF) is NOT Swiss", !isSwissSection(109));
check("section 110 (GF) is NOT Swiss", !isSwissSection(110));
check("section 0 is NOT Swiss", !isSwissSection(0));
check("section 999 is NOT Swiss", !isSwissSection(999));

// --- Summary ------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
