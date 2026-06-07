/**
 * verify-compare-scoring-consistency — future-proof guard for PHA-946.
 *
 * PHA-946 bug: the compare page judged a Swiss pick by its EXACT slot, while
 * scoring.ts judges Swiss buckets as interchangeable SETS (PHA-918). A correct
 * pick sitting in a different slot than its winner row read as a miss — the
 * compare grid disagreed with the score.
 *
 * The fix routed the compare grid + steal reel through the same bucket helpers
 * (`resolveBucketWinners` / `bucketPickState`). This guard LOCKS that alignment
 * for every future stage and major: for a battery of synthetic sections —
 * Swiss at the current 10-slot size AND a future-major non-10 fallback size,
 * with picks deliberately shuffled across their bucket, partially and fully
 * resolved, plus a per-match playoff section — it asserts the number of tiles
 * the compare grid lights as HIT equals exactly the picks the REAL scorePlayer
 * counts as correct. If anyone later changes the grain on either side, this
 * fails. It imports the real engine (scoring.ts has only a type import of the
 * layout, erased at runtime), so it can't drift from production.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./register-ts-resolve.mjs scripts/verify-compare-scoring-consistency.ts
 */

import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "../src/lib/scoring.ts";
import type { Layout, Section } from "../src/lib/layout.ts";
import {
  bucketSwissSlots,
  isSwissSection,
  resolveBucketWinners,
  bucketPickState,
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

type SlotMap = { [slotIndex: number]: number };

/** Build a one-group section with `slotCount` slots, 1 pt each. */
function section(sectionid: number, name: string, slotCount: number): Section {
  return {
    sectionid,
    name,
    groups: [
      {
        groupid: 1,
        name,
        points_per_pick: 1,
        picks: Array.from({ length: slotCount }, (_, i) => ({ index: i, pickid: 0 })),
      },
    ],
  } as unknown as Section;
}

/**
 * Replicate the compare page's grid grain EXACTLY (page lines ~548-588, with the
 * display-only `impossible` flag off — it never changes the score). Count tiles
 * the grid would light as "hit". This is the same code path the page renders.
 */
function gridHitCount(sec: Section, picks: PlayerPickMap[string], outcomes: OutcomeMap): number {
  let hits = 0;
  const isSwiss = isSwissSection(sec.sectionid);
  for (const group of sec.groups) {
    const groupPicks: SlotMap = picks[sec.sectionid]?.[group.groupid] ?? {};
    const groupOutcomes: SlotMap = outcomes[sec.sectionid]?.[group.groupid] ?? {};
    const buckets = isSwiss
      ? bucketSwissSlots(group.picks.length)
      : group.picks.map((p) => ({ label: "", slotIndexes: [p.index] }));
    for (const bucket of buckets) {
      const swissRes = isSwiss ? resolveBucketWinners(bucket.slotIndexes, groupOutcomes) : null;
      for (const slot of bucket.slotIndexes) {
        const res = swissRes ?? resolveBucketWinners([slot], groupOutcomes);
        if (bucketPickState(groupPicks[slot], res, false) === "hit") hits++;
      }
    }
  }
  return hits;
}

/** scorePlayer's `correct` for a single-section synthetic layout. */
function scoringCorrect(sec: Section, picks: PlayerPickMap[string], outcomes: OutcomeMap): number {
  const layout = { sections: [sec] } as unknown as Layout;
  return scorePlayer(layout, picks, outcomes).bySection[0].correct;
}

/** Assert the grid's hit count agrees with the score for one scenario. */
function assertConsistent(label: string, sec: Section, picks: PlayerPickMap[string], outcomes: OutcomeMap, expectHits: number) {
  const grid = gridHitCount(sec, picks, outcomes);
  const score = scoringCorrect(sec, picks, outcomes);
  check(`${label}: grid hits (${grid}) == scoring correct (${score})`, grid === score);
  check(`${label}: hits == expected ${expectHits}`, grid === expectHits);
}

const wrap = (sectionid: number, slots: SlotMap): PlayerPickMap[string] => ({ [sectionid]: { 1: slots } });
const wrapO = (sectionid: number, slots: SlotMap): OutcomeMap => ({ [sectionid]: { 1: slots } });

// ── 1. 10-slot Swiss, the exact PHA-946 trap: picks shuffled vs winner slots ──
// Buckets: 3:0 = [0,1], 3:1/3:2 = [2..7], 0:3 = [8,9]. Player tags advancers in
// DIFFERENT slots than where their winner rows land. All should still be hits.
{
  const S = section(105, "Stage I | Swiss", 10);
  // winners landed: 3:0 = {801,802}; advance = {901,902,903,904,905,906}; 0:3 = {701,702}
  const outcomes = wrapO(105, { 0: 801, 1: 802, 2: 901, 3: 902, 4: 903, 5: 904, 6: 905, 7: 906, 8: 701, 9: 702 });
  // player picks every winning team but in scrambled slots within each bucket
  const picks = wrap(105, { 0: 802, 1: 801, 2: 906, 3: 905, 4: 904, 5: 903, 6: 902, 7: 901, 8: 702, 9: 701 });
  assertConsistent("Stage I all-correct shuffled", S, picks, outcomes, 10);
}

// ── 2. 10-slot Swiss, MIBR-in-wrong-slot + some genuine misses ───────────────
{
  const S = section(106, "Stage II | Swiss", 10); // a LATER stage id — must behave identically
  const MIBR = 900;
  const outcomes = wrapO(106, { 0: 801, 1: 802, 2: MIBR, 3: 902, 4: 903, 5: 904, 6: 905, 7: 906, 8: 701, 9: 702 });
  // player put MIBR in slot 6 (advance bucket, different slot than its winner row 2),
  // got 801 (3:0) right, but mis-tagged 999 (never advanced) and left others blank.
  const picks = wrap(106, { 0: 801, 6: MIBR, 7: 999 });
  // hits: 801 (in 3:0 set) + MIBR (in advance set) = 2; 999 is not a winner.
  assertConsistent("Stage II MIBR-wrong-slot + a miss", S, picks, outcomes, 2);
  check(
    "PHA-946 property: MIBR picked slot6, won slot2 → HIT not miss",
    bucketPickState(MIBR, resolveBucketWinners([2, 3, 4, 5, 6, 7], { 2: MIBR, 3: 902, 4: 903, 5: 904, 6: 905, 7: 906 })) === "hit",
  );
}

// ── 3. 10-slot Swiss, partially resolved (advance bucket only half decided) ──
{
  const S = section(107, "Stage III | Swiss", 10);
  // only 3:0 + three of the advance slots resolved; rest unresolved (sentinel 0 / absent)
  const outcomes = wrapO(107, { 0: 801, 1: 802, 2: 901, 3: 902, 4: 903 });
  const picks = wrap(107, { 0: 801, 5: 901, 9: 902 });
  // 3:0[0,1] winners {801,802}: pick 801 → hit. advance[2..7] partial winners
  // {901,902,903}: pick 901 (slot5) → hit. 902 sits in slot9 — the 0:3 bucket
  // [8,9], whose winners are unresolved — so it is PENDING, not credited as an
  // advance hit. Two hits, and scoring agrees: bucket placement is load-bearing.
  assertConsistent("Stage III partial resolution", S, picks, outcomes, 2);
}

// ── 4. Future-major Swiss with a NON-10 slot count (fallback single bucket) ──
// bucketSwissSlots collapses to one flat bucket; compare + scoring share that
// fallback, so they must STILL agree. Proves the guard for a different format.
{
  const S = section(105, "Stage I | 16-team Swiss", 16);
  const outcomes: OutcomeMap = wrapO(105, Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i, 600 + i])));
  // pick 8 of the 16 winners, scattered; 2 bogus
  const picks = wrap(105, { 0: 605, 1: 603, 2: 6000, 4: 600, 7: 612, 9: 6001, 11: 615, 13: 608, 14: 610, 15: 602 });
  // winners present among picks: 605,603,600,612,615,608,610,602 = 8 (6000/6001 bogus)
  assertConsistent("future-major 16-slot Swiss fallback", S, picks, outcomes, 8);
  check("16 slots → single fallback bucket", bucketSwissSlots(16).length === 1);
}

// ── 5. Playoff section (non-Swiss): strict per-slot, must also stay consistent ─
{
  const S = section(108, "Quarterfinals | Playoffs", 4);
  const outcomes = wrapO(108, { 0: 401, 1: 402, 2: 403, 3: 404 });
  // playoffs are per-slot: a right team in the WRONG slot is a MISS (unlike Swiss)
  const picks = wrap(108, { 0: 401, 1: 999, 2: 404, 3: 404 }); // slot0 right; slot2 wrong(404≠403); slot3 right
  assertConsistent("Playoffs strict per-slot", S, picks, outcomes, 2);
  check("section 108 is NOT Swiss (per-slot)", !isSwissSection(108));
  check(
    "playoff property: right team in wrong slot is a MISS",
    bucketPickState(404, resolveBucketWinners([2], { 2: 403 })) === "miss",
  );
}

// ── 6. Degenerate: no picks / no outcomes resolve to zero hits, still consistent ─
{
  const S = section(105, "Stage I | Swiss", 10);
  assertConsistent("empty picks", S, wrap(105, {}), wrapO(105, { 0: 801, 1: 802 }), 0);
  assertConsistent("no outcomes", S, wrap(105, { 0: 801 }), wrapO(105, {}), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
