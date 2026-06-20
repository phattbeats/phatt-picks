/**
 * verify-playoff-bracket - offline proof for the single-elim playoffs bracket
 * (PHA-903).
 *
 * playoff-bracket-core builds the QF → SF → GF tree from the committed playoff
 * sections (108/109/110 in cologne-layout.json) enriched with the viewer's picks
 * and resolved winners. This proves:
 *   - the honest EMPTY state (every slot TBD, the `???` tree Brandon's reference
 *     shows pre-seeding),
 *   - seeding (real team slots show their pickid),
 *   - results (a resolved winner lights its side; the loser doesn't),
 *   - the viewer's call grading (hit / miss / pending),
 *   - the champion + summary tallies,
 * all against the REAL committed layout (no hand-mocked sections).
 *
 * Run: node scripts/verify-playoff-bracket.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPlayoffBracket,
  summarizePlayoffPicks,
  isPlayoffSection,
  playoffRoundForSection,
  PLAYOFF_ROUNDS,
} from "../src/lib/playoff-bracket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;

const playoffSections: Section[] = layout.sections.filter((s) => isPlayoffSection(s.sectionid));

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name + (detail ? `  (${detail})` : ""));
  }
}

/** Deep-clone the committed sections and overwrite team slots / labels for tests. */
function clone(sections: readonly Section[]): Section[] {
  return JSON.parse(JSON.stringify(sections)) as Section[];
}
const groupId = (sections: readonly Section[], sectionId: number, idx: number) =>
  sections.find((s) => s.sectionid === sectionId)!.groups[idx].groupid;

console.log("\nplayoff-bracket - section identity helpers");
check("108/109/110 are playoff sections", [108, 109, 110].every(isPlayoffSection));
check("a Swiss section (105) is NOT a playoff section", !isPlayoffSection(105));
check("playoffRoundForSection(108) → QF", playoffRoundForSection(108)?.key === "QF");
check("playoffRoundForSection(110) → GF", playoffRoundForSection(110)?.key === "GF");
check("playoffRoundForSection(105) → null", playoffRoundForSection(105) === null);
check("PLAYOFF_ROUNDS is QF→SF→GF in order", PLAYOFF_ROUNDS.map((r) => r.key).join(",") === "QF,SF,GF");

console.log("\nplayoff-bracket - committed layout has the QF/SF/GF skeleton");
check("found all three playoff sections in the committed layout", playoffSections.length === 3,
  `got ${playoffSections.length}`);

console.log("\nplayoff-bracket - honest EMPTY state (pre-seeding, the `???` tree)");
// The committed fixture now seeds the QF (PHA-1007), so the pre-seeding empty
// state is verified against an explicitly unseeded clone.
const unseeded = clone(playoffSections);
for (const s of unseeded) for (const g of s.groups) g.teams = g.teams.map(() => ({ pickid: 0 }));
const empty = buildPlayoffBracket({ sections: unseeded });
check("3 rounds in QF→SF→GF order", empty.rounds.map((r) => r.key).join(",") === "QF,SF,GF");
check("QF has 4 matches", empty.rounds[0].matches.length === 4, `got ${empty.rounds[0].matches.length}`);
check("SF has 2 matches", empty.rounds[1].matches.length === 2);
check("GF has 1 match", empty.rounds[2].matches.length === 1);
check("7 matches total", empty.totalMatches === 7, `got ${empty.totalMatches}`);
check("every slot is TBD (pickid null) pre-seeding", empty.rounds.every((r) =>
  r.matches.every((m) => m.team1.pickid === null && m.team2.pickid === null)));
check("nothing seeded / decided yet", !empty.anySeeded && !empty.anyDecided);
check("no champion yet", empty.championPickid === null);
check("no winner lit on any side", empty.rounds.every((r) =>
  r.matches.every((m) => !m.team1.winner && !m.team2.winner)));
check("match labels read from layout group names (QF 'Match 1', GF 'Final')",
  empty.rounds[0].matches[0].label === "Match 1" && empty.rounds[2].matches[0].label === "Final",
  `QF0='${empty.rounds[0].matches[0].label}', GF='${empty.rounds[2].matches[0].label}'`);

console.log("\nplayoff-bracket - seeding fills the slots (no fabricated result)");
const seeded = clone(playoffSections);
const qf = seeded.find((s) => s.sectionid === 108)!;
// Seed QF Match 1 with two real teams from the layout pool.
const [A, B, C, D] = layout.teams.slice(0, 4).map((t) => t.pickid);
qf.groups[0].teams = [{ pickid: A }, { pickid: B }];
qf.groups[1].teams = [{ pickid: C }, { pickid: D }];
const seededBracket = buildPlayoffBracket({ sections: seeded });
check("seeded QF Match 1 carries both pickids", (() => {
  const m = seededBracket.rounds[0].matches[0];
  return m.team1.pickid === A && m.team2.pickid === B && m.seeded;
})());
check("seeded match is set but NOT decided (no winner invented)", (() => {
  const m = seededBracket.rounds[0].matches[0];
  return m.seeded && !m.decided && !m.team1.winner && !m.team2.winner;
})());
check("a half-seeded match (one TBD slot) is not 'seeded'", (() => {
  const half = clone(playoffSections);
  half.find((s) => s.sectionid === 108)!.groups[2].teams = [{ pickid: A }, { pickid: 0 }];
  const b = buildPlayoffBracket({ sections: half });
  return b.rounds[0].matches[2].seeded === false && b.rounds[0].matches[2].team1.pickid === A
    && b.rounds[0].matches[2].team2.pickid === null;
})());
check("anySeeded true once any match has both teams", seededBracket.anySeeded);

console.log("\nplayoff-bracket - resolved winners light the right side");
const gQF1 = groupId(seeded, 108, 0);
const winners = new Map<number, number>([[gQF1, B]]); // team B beats team A
const decided = buildPlayoffBracket({ sections: seeded, winnerByGroup: winners });
check("decided match lights the winner, dims the loser", (() => {
  const m = decided.rounds[0].matches[0];
  return m.decided && m.team2.winner && !m.team1.winner;
})());
check("anyDecided true", decided.anyDecided);

console.log("\nplayoff-bracket - viewer's call grading (hit / miss / pending)");
const gQF2 = groupId(seeded, 108, 1);
const userPicks = new Map<number, number>([
  [gQF1, B], // called B — and B won → hit
  [gQF2, C], // called C in an undecided match → pending
]);
const graded = buildPlayoffBracket({ sections: seeded, winnerByGroup: winners, userPickByGroup: userPicks });
check("called the winner → hit, and that side is flagged userPicked", (() => {
  const m = graded.rounds[0].matches[0];
  return m.userResult === "hit" && m.team2.userPicked && !m.team1.userPicked;
})());
check("called a team in an undecided match → pending", graded.rounds[0].matches[1].userResult === "pending");
check("no pick for a match → userResult null", graded.rounds[0].matches[2].userResult === null);
check("a wrong call → miss", (() => {
  const wrong = new Map<number, number>([[gQF1, A]]); // called A but B won
  const g = buildPlayoffBracket({ sections: seeded, winnerByGroup: winners, userPickByGroup: wrong });
  return g.rounds[0].matches[0].userResult === "miss";
})());
check("a pick for a TBD slot (pickid 0) is ignored, not flagged", (() => {
  const g = buildPlayoffBracket({ sections: playoffSections, userPickByGroup: new Map([[gQF1, 0]]) });
  return g.rounds[0].matches[0].userResult === null;
})());

console.log("\nplayoff-bracket - champion + score overlay + summary");
const full = clone(playoffSections);
const gGF = groupId(full, 110, 0);
full.find((s) => s.sectionid === 110)!.groups[0].teams = [{ pickid: A }, { pickid: B }];
const champBracket = buildPlayoffBracket({
  sections: full,
  winnerByGroup: new Map([[gGF, A]]),
  scoreByGroup: new Map([[gGF, [2, 1] as const]]),
});
check("GF winner becomes the champion", champBracket.championPickid === A, `got ${champBracket.championPickid}`);
check("score overlay attaches a series score to each side", (() => {
  const gf = champBracket.rounds[2].matches[0];
  return gf.team1.score === 2 && gf.team2.score === 1;
})());
check("no champion while the GF is undecided", (() => {
  const b = buildPlayoffBracket({ sections: full });
  return b.championPickid === null;
})());
const sum = summarizePlayoffPicks(graded);
check("summary tallies picks/hits/pending", sum.picks === 2 && sum.hits === 1 && sum.pending === 1 && sum.misses === 0,
  JSON.stringify(sum));
check("empty bracket summary is all zero", (() => {
  const s = summarizePlayoffPicks(empty);
  return s.picks === 0 && s.hits === 0 && s.misses === 0 && s.pending === 0;
})());

console.log("\nplayoff-bracket - graceful with missing sections");
const onlyQF = buildPlayoffBracket({ sections: playoffSections.filter((s) => s.sectionid === 108) });
check("a subset of sections → just those rounds (QF only)", (() => {
  return onlyQF.rounds.length === 1 && onlyQF.rounds[0].key === "QF";
})());
check("no playoff sections → empty bracket, no throw", (() => {
  const b = buildPlayoffBracket({ sections: [] });
  return b.rounds.length === 0 && b.totalMatches === 0 && b.championPickid === null;
})());

console.log("\nplayoff-bracket - awaitingResult (started, seeded, still undecided) — PHA-1016");
// QF Match 1 (section 108, game 0) is committed for 2026-06-18T13:45:00Z.
const QF1_START_MS = Date.parse("2026-06-18T13:45:00Z");
const awaitingSections = clone(playoffSections);
awaitingSections.find((s) => s.sectionid === 108)!.groups[0].teams = [{ pickid: A }, { pickid: B }];
const gAwaitQF1 = groupId(awaitingSections, 108, 0);
const awaitingMatch = (inputs: Parameters<typeof buildPlayoffBracket>[0]) =>
  buildPlayoffBracket(inputs).rounds[0].matches[0];
check("seeded + undecided + start passed → awaitingResult", (() => {
  const m = awaitingMatch({ sections: awaitingSections, nowMs: QF1_START_MS + 60_000 });
  return m.awaitingResult === true && m.seeded && !m.decided;
})());
check("exactly at the start instant counts as started (<=)", (() => {
  return awaitingMatch({ sections: awaitingSections, nowMs: QF1_START_MS }).awaitingResult === true;
})());
check("before start → not awaiting", (() => {
  return awaitingMatch({ sections: awaitingSections, nowMs: QF1_START_MS - 60_000 }).awaitingResult === false;
})());
check("no nowMs supplied → never awaiting (renders exactly as before)", (() => {
  return awaitingMatch({ sections: awaitingSections }).awaitingResult === false;
})());
check("decided match is not awaiting even past start", (() => {
  const m = awaitingMatch({
    sections: awaitingSections,
    winnerByGroup: new Map([[gAwaitQF1, A]]),
    nowMs: QF1_START_MS + 3 * 3600_000,
  });
  return m.decided && m.awaitingResult === false;
})());
check("unseeded (TBD) match is never awaiting", (() => {
  // GF (section 110) ships TBD-vs-TBD in the committed fixture.
  const b = buildPlayoffBracket({ sections: awaitingSections, nowMs: QF1_START_MS + 3 * 3600_000 });
  const gf = b.rounds[2].matches[0];
  return !gf.seeded && gf.awaitingResult === false;
})());

console.log(`\nplayoff-bracket: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
