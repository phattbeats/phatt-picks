/**
 * verify-consensus - offline proof for PHA-889 (pick consensus %).
 *
 * The consensus signal must be honest read-side arithmetic:
 *   1. The denominator is the field that actually picked the slot — pickId 0
 *      (TBD/unset) rows are excluded, never inflating or deflating a share.
 *   2. Shares sum to ~100% (modulo integer rounding) and are sorted most-picked
 *      first, ties broken deterministically by pickId so the bar order is stable.
 *   3. Slots are kept distinct by (sectionId, groupId, slotIndex) — a team's
 *      popularity in one slot never bleeds into another, even with reused ids.
 *   4. shareFor answers "what % made MY pick" and returns null for an unpicked
 *      slot / team, so a surface can't render a fabricated 0%.
 *
 * Pure module, no DB — exercises consensus-core directly.
 * Run: node scripts/verify-consensus.ts
 */

import {
  buildConsensus,
  consensusKey,
  shareFor,
  buildBucketConsensus,
  bucketShareFor,
  type ConsensusPickRow,
  type BucketPickRow,
} from "../src/lib/consensus-core.ts";

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

// One slot (sec 105 / grp 271 / slot 0): 10 players pick, 2 left it TBD (pickId 0).
//   team 7 ×6, team 9 ×3, team 4 ×1  → 60% / 30% / 10% over a field of 10.
const slotA: ConsensusPickRow[] = [
  ...Array.from({ length: 6 }, () => ({ sectionId: 105, groupId: 271, slotIndex: 0, pickId: 7 })),
  ...Array.from({ length: 3 }, () => ({ sectionId: 105, groupId: 271, slotIndex: 0, pickId: 9 })),
  { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 4 },
  // Two unset picks — must NOT count toward the denominator.
  { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 0 },
  { sectionId: 105, groupId: 271, slotIndex: 0, pickId: 0 },
];

// A different slot that reuses team id 7 — must stay isolated from slotA.
const slotB: ConsensusPickRow[] = [
  { sectionId: 105, groupId: 271, slotIndex: 1, pickId: 7 },
  { sectionId: 105, groupId: 271, slotIndex: 1, pickId: 7 },
];

console.log("\nconsensus - distribution math (PHA-889)");

const c = buildConsensus([...slotA, ...slotB]);
const a = c.get(consensusKey(105, 271, 0))!;

check("TBD (pickId 0) rows excluded → field total is 10, not 12", a.total === 10);
check("most-picked team sorts first (team 7)", a.shares[0]?.pickId === 7);
check("team 7 → 60%", a.shares[0]?.pct === 60);
check("team 9 → 30% (second)", a.shares[1]?.pickId === 9 && a.shares[1]?.pct === 30);
check("team 4 → 10% (third)", a.shares[2]?.pickId === 4 && a.shares[2]?.pct === 10);
check("exactly three teams in the split", a.shares.length === 3);
check(
  "shares sum to 100% for this clean case",
  a.shares.reduce((s, x) => s + x.pct, 0) === 100,
);
check("counts sum back to the field total", a.shares.reduce((s, x) => s + x.count, 0) === a.total);

const b = c.get(consensusKey(105, 271, 1))!;
check("slot isolation: reused team 7 in slot 1 is a separate 100%/2", b.total === 2 && b.shares[0]?.pct === 100);

console.log("\nconsensus - tie-break is deterministic (pickId asc)");

const tie = buildConsensus([
  { sectionId: 1, groupId: 1, slotIndex: 0, pickId: 30 },
  { sectionId: 1, groupId: 1, slotIndex: 0, pickId: 10 },
]).get(consensusKey(1, 1, 0))!;
check("equal counts → lower pickId first", tie.shares[0]?.pickId === 10 && tie.shares[1]?.pickId === 30);

console.log("\nconsensus - shareFor lookups");

check("shareFor returns the picked team's share", shareFor(c, 105, 271, 0, 9)?.pct === 30);
check("shareFor on a team nobody picked → null", shareFor(c, 105, 271, 0, 999) === null);
check("shareFor on an unknown slot → null", shareFor(c, 999, 999, 9, 7) === null);
check("shareFor with pickId 0 (unset) → null", shareFor(c, 105, 271, 0, 0) === null);

console.log("\nconsensus - empty / all-TBD inputs");

check("empty input → empty map", buildConsensus([]).size === 0);
check(
  "a slot where everyone is TBD produces no entry (no 0/0 division)",
  buildConsensus([{ sectionId: 2, groupId: 2, slotIndex: 0, pickId: 0 }]).size === 0,
);

console.log("\nbucket consensus - Swiss slots are interchangeable within a bucket (PHA-900)");

// The 0:3 bucket is slots 8 & 9 (sec 105). Five players each name two 0:3 teams.
// Thunder Down Under (pickId 50) is on EVERY player's 0:3 — but four of them put
// it in slot 8 and one in slot 9. Per-slot consensus would call the slot-9 entry
// a "lone call"; the bucket must see all five as the same call.
const tdu: BucketPickRow[] = [
  { playerId: "p1", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 50 },
  { playerId: "p2", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 50 },
  { playerId: "p3", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 50 },
  { playerId: "p4", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 50 },
  { playerId: "p5", sectionId: 105, groupId: 271, slotIndex: 9, pickId: 50 }, // different 0:3 slot
  // each player's SECOND 0:3 pick — all different teams
  { playerId: "p1", sectionId: 105, groupId: 271, slotIndex: 9, pickId: 61 },
  { playerId: "p2", sectionId: 105, groupId: 271, slotIndex: 9, pickId: 62 },
  { playerId: "p3", sectionId: 105, groupId: 271, slotIndex: 9, pickId: 63 },
  { playerId: "p4", sectionId: 105, groupId: 271, slotIndex: 9, pickId: 64 },
  { playerId: "p5", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 65 },
];
const bc = buildBucketConsensus(tdu);
const tduSlot8 = bucketShareFor(bc, 105, 271, 8, 50)!;
const tduSlot9 = bucketShareFor(bc, 105, 271, 9, 50)!;
check("TDU counts all 5 players regardless of which 0:3 slot (via slot 8)", tduSlot8.count === 5 && tduSlot8.total === 5);
check("same bucket share whether you look it up via slot 8 or slot 9", tduSlot9.count === 5 && tduSlot9.total === 5);
check("TDU reads as 'Whole board', not a lone call (count === total)", tduSlot8.count === tduSlot8.total);
check("a one-off second 0:3 pick (team 61) is the lone call", bucketShareFor(bc, 105, 271, 9, 61)?.count === 1);
check("denominator is DISTINCT players (5), not the 10 pick rows", tduSlot8.total === 5);

// Bucket boundaries: the 3:0 bucket (slots 0,1) must NOT merge with 0:3.
const cross: BucketPickRow[] = [
  { playerId: "p1", sectionId: 105, groupId: 271, slotIndex: 0, pickId: 50 }, // TDU to go 3:0
  { playerId: "p1", sectionId: 105, groupId: 271, slotIndex: 8, pickId: 50 }, // (illegal in practice, but proves keys don't merge)
];
const crossBc = buildBucketConsensus(cross);
check("3:0 and 0:3 buckets stay separate", bucketShareFor(crossBc, 105, 271, 0, 50)!.count === 1 && bucketShareFor(crossBc, 105, 271, 8, 50)!.count === 1);
check("advancing bucket (slot 2-7) is its own grain", buildBucketConsensus([{ playerId: "p1", sectionId: 105, groupId: 271, slotIndex: 4, pickId: 70 }]).size === 1);

// Non-Swiss (playoff) sections stay per-slot — each match is a distinct call.
const po: BucketPickRow[] = [
  { playerId: "p1", sectionId: 200, groupId: 9, slotIndex: 0, pickId: 12 },
  { playerId: "p2", sectionId: 200, groupId: 9, slotIndex: 0, pickId: 12 },
  { playerId: "p1", sectionId: 200, groupId: 10, slotIndex: 0, pickId: 12 },
];
const poBc = buildBucketConsensus(po);
check("playoff match stays per-slot (2 agree on group 9)", bucketShareFor(poBc, 200, 9, 0, 12)!.count === 2);
check("a different playoff match (group 10) is separate", bucketShareFor(poBc, 200, 10, 0, 12)!.count === 1);

check("bucketShareFor with pickId 0 → null", bucketShareFor(bc, 105, 271, 8, 0) === null);
check("bucketShareFor on a team nobody picked → null", bucketShareFor(bc, 105, 271, 8, 999) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
