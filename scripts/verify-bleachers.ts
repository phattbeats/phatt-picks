/**
 * verify-bleachers — offline proof for PHA-1211 (The Bleachers, concept A).
 *
 * The tally + reveal rules must be honest read-side arithmetic:
 *   1. Counts group by stampId across all senders; the public number never
 *      leaks who dropped what.
 *   2. `mine` is true iff the viewer is among that stamp's senders — so the
 *      viewer sees their own drop as active while everyone else stays masked.
 *   3. Tallies sort by count desc, ties broken by the canonical STAMPS order,
 *      so the row order is stable.
 *   4. Unknown stampIds (a stamp retired after rows were written) are dropped,
 *      never rendered blank, and never counted in totals.
 *   5. Senders are unmasked ONLY once the stage resolves — the same gate the
 *      rest of the app applies to picks, so a name can't surface early.
 *
 * Pure module, no DB — exercises bleachers-core directly.
 * Run: node scripts/verify-bleachers.ts
 */

import {
  STAMPS,
  getStamp,
  isValidStampId,
  tallyReactions,
  totalReactions,
  bleachersUnmasked,
  pickTargetKey,
  type ReactionLike,
} from "../src/lib/bleachers-core.ts";

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

// A pick with reactions from 4 senders: fire×2, ice×1 (one of them the viewer), cope×1.
const rows: ReactionLike[] = [
  { stampId: "fire", senderId: "a" },
  { stampId: "fire", senderId: "b" },
  { stampId: "ice", senderId: "me" },
  { stampId: "cope", senderId: "c" },
];

const t = tallyReactions(rows, "me");

check("vocabulary is the fixed set", STAMPS.length === 5 && isValidStampId("fire") && !isValidStampId("nope"));
check("getStamp returns the glyph", getStamp("ice")?.glyph === "🧊");

check("counts group by stamp", t.find((x) => x.stamp.id === "fire")?.count === 2);
check("ice counted once", t.find((x) => x.stamp.id === "ice")?.count === 1);
check("totalReactions sums all", totalReactions(rows) === 4);

check("mine flag set only on the viewer's stamp", t.find((x) => x.stamp.id === "ice")?.mine === true);
check("other stamps are not mine", t.find((x) => x.stamp.id === "fire")?.mine === false);
check("a non-sender viewer owns nothing", tallyReactions(rows, "stranger").every((x) => !x.mine));
check("anon viewer (null) owns nothing", tallyReactions(rows, null).every((x) => !x.mine));

check("sorted by count desc", t[0].stamp.id === "fire" && t[0].count === 2);

// Ties (ice 1, cope 1, bold 1) break by canonical STAMPS order: bold < ice < cope.
const tie = tallyReactions(
  [
    { stampId: "ice", senderId: "x" },
    { stampId: "cope", senderId: "y" },
    { stampId: "bold", senderId: "z" },
  ],
  null,
);
const order = new Map(STAMPS.map((s, i) => [s.id, i]));
check(
  "ties break by canonical order",
  tie.length === 3 &&
    order.get(tie[0].stamp.id)! < order.get(tie[1].stamp.id)! &&
    order.get(tie[1].stamp.id)! < order.get(tie[2].stamp.id)!,
);

// Unknown stamp ids are dropped, never rendered, never counted.
const withGhost: ReactionLike[] = [...rows, { stampId: "retired-glyph", senderId: "d" }];
check("unknown stampId dropped from tally", tallyReactions(withGhost, null).every((x) => isValidStampId(x.stamp.id)));
check("unknown stampId not in total", totalReactions(withGhost) === 4);

// Empty pick → empty tally, zero total.
check("no rows → empty tally", tallyReactions([], "me").length === 0 && totalReactions([]) === 0);

// Reveal gate: masked until the stage resolves.
check("masked while unresolved", bleachersUnmasked(false) === false);
check("unmasked once resolved", bleachersUnmasked(true) === true);

// Target key is stable + distinct per slot.
check("pickTargetKey is stable", pickTargetKey(105, 271, 0) === "105:271:0");
check("pickTargetKey distinct per slot", pickTargetKey(105, 271, 0) !== pickTargetKey(105, 271, 1));

console.log(`\nverify-bleachers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
