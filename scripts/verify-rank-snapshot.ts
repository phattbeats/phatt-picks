/**
 * Offline verify for the PHA-858 rank-snapshot core (no prisma, no fixture).
 * Mirrors the M4 verify pattern: build a tiny layout + picks + outcomes, then
 * assert cumulative ranking, snapshot rows, section selectors, and delta dir.
 *
 *   npx tsx scripts/verify-rank-snapshot.ts
 */

import type { Layout } from "../src/lib/layout";
import type { PlayerPickMap, OutcomeMap } from "../src/lib/scoring";
import {
  buildSnapshotRows,
  rankStandings,
  restrictOutcomes,
  rankDelta,
  baselineSectionId,
  latestSectionId,
  previousResolvedSection,
} from "../src/lib/rank-snapshot-core";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Fixture: sec1 (Swiss, 1pt) favors C; sec2 (Playoffs, 5pt) favors A ------
const layout: Layout = {
  event: 26,
  name: "Test",
  teams: [
    { pickid: 101, logo: "a", name: "T101" },
    { pickid: 102, logo: "b", name: "T102" },
    { pickid: 103, logo: "c", name: "T103" },
    { pickid: 201, logo: "d", name: "T201" },
    { pickid: 202, logo: "e", name: "T202" },
  ],
  sections: [
    {
      sectionid: 1,
      name: "Opening | Swiss",
      groups: [
        {
          groupid: 10,
          name: "G10",
          points_per_pick: 1,
          picks_allowed: false,
          teams: [{ pickid: 101 }, { pickid: 102 }, { pickid: 103 }],
          picks: [
            { index: 0, pickids: [] },
            { index: 1, pickids: [] },
            { index: 2, pickids: [] },
          ],
        },
      ],
    },
    {
      sectionid: 2,
      name: "Playoffs | Bracket",
      groups: [
        {
          groupid: 20,
          name: "G20",
          points_per_pick: 5,
          picks_allowed: false,
          teams: [{ pickid: 201 }, { pickid: 202 }],
          picks: [{ index: 0, pickids: [] }],
        },
      ],
    },
  ],
};

const players = [
  { id: "A", displayName: "Alpha" },
  { id: "B", displayName: "Bravo" },
  { id: "C", displayName: "Charlie" },
];

const pickMap: PlayerPickMap = {
  A: { 1: { 10: { 0: 101, 1: 102, 2: 103 } }, 2: { 20: { 0: 201 } } },
  B: { 1: { 10: { 0: 101, 1: 103, 2: 102 } }, 2: { 20: { 0: 202 } } },
  C: { 1: { 10: { 0: 103, 1: 102, 2: 101 } } },
};

const outcomes: OutcomeMap = {
  1: { 10: { 0: 103, 1: 102, 2: 101 } }, // all 3 → C correct on all, A on 1 (102), B on 0
  2: { 20: { 0: 201 } }, // A correct (+5)
};
const resolved = [1, 2];

console.log("restrictOutcomes");
const onlyS1 = restrictOutcomes(outcomes, 1);
check("excludes section 2", onlyS1[2] === undefined && !!onlyS1[1]);

console.log("rankStandings (cumulative through sec1)");
const s1 = rankStandings(layout, players, pickMap, restrictOutcomes(outcomes, 1));
const r1 = Object.fromEntries(s1.map((e) => [e.playerId, e.rank]));
check("C is 1st after Opening", r1.C === 1);
check("A is 2nd after Opening", r1.A === 2);
check("B is 3rd after Opening", r1.B === 3);
check("C score = 3 after Opening", s1.find((e) => e.playerId === "C")?.score === 3);
check("A score = 1 after Opening", s1.find((e) => e.playerId === "A")?.score === 1);

console.log("rankStandings (cumulative through sec2)");
const s2 = rankStandings(layout, players, pickMap, restrictOutcomes(outcomes, 2));
const r2 = Object.fromEntries(s2.map((e) => [e.playerId, e.rank]));
check("A is 1st after Playoffs (1+5=6)", r2.A === 1);
check("C is 2nd after Playoffs (3)", r2.C === 2);
check("B is 3rd after Playoffs (0)", r2.B === 3);
check("A score = 6 after Playoffs", s2.find((e) => e.playerId === "A")?.score === 6);

console.log("buildSnapshotRows");
const rows = buildSnapshotRows(layout, resolved, players, pickMap, outcomes);
const find = (pid: string, sec: number) => rows.find((r) => r.playerId === pid && r.sectionId === sec);
check("one row per player per section (6)", rows.length === 6);
check("sec1 snapshot C rank 1", find("C", 1)?.rank === 1);
check("sec1 snapshot A rank 2", find("A", 1)?.rank === 2);
check("sec2 snapshot A rank 1", find("A", 2)?.rank === 1);
check("sec2 snapshot C rank 2", find("C", 2)?.rank === 2);

console.log("section selectors");
check("baselineSectionId([1,2]) = 1", baselineSectionId(resolved) === 1);
check("latestSectionId([1,2]) = 2", latestSectionId(resolved) === 2);
check("previousResolvedSection(.,2) = 1", previousResolvedSection(resolved, 2) === 1);
check("previousResolvedSection(.,1) = null", previousResolvedSection(resolved, 1) === null);
check("baselineSectionId single = null", baselineSectionId([5]) === null);
check("latestSectionId([]) = null", latestSectionId([]) === null);

console.log("rankDelta (across Playoffs: A 2→1 up, C 1→2 down, B flat, X new)");
check("A climbed up 1", (() => { const d = rankDelta(1, 2); return d.direction === "up" && d.delta === 1; })());
check("C dropped down 1", (() => { const d = rankDelta(2, 1); return d.direction === "down" && d.delta === -1; })());
check("B held flat 0", (() => { const d = rankDelta(3, 3); return d.direction === "flat" && d.delta === 0; })());
check("no baseline = new", (() => { const d = rankDelta(4, undefined); return d.direction === "new" && d.delta === null; })());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
