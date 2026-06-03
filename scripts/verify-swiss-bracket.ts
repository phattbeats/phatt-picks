/**
 * verify-swiss-bracket - offline proof for the live Swiss BRACKET (PHA-902).
 *
 * swiss-bracket-core lifts HLTV's per-match data (the `data-match-details-popup
 * -json` blobs the event page embeds in each bracket cell) out of the rendered
 * HTML, groups it by round label (0:0 → 1:0 / 0:1 → 2:0 / 1:1 / 0:2 …), and maps
 * each side to a committed layout team. This loads a REAL captured snapshot of
 * the live Stage I bracket HTML (src/fixtures/hltv-stage1-bracket.sample.html,
 * IEM Cologne Major 2026 Stage 1, 02/06/26) and proves the parse + classify +
 * layout-match against it.
 *
 * Run: node scripts/verify-swiss-bracket.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSwissBracket,
  matchBracketToLayout,
  bracketRoundKind,
  bracketSummary,
} from "../src/lib/swiss-bracket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;
const stage1: Section = layout.sections.find((s) => s.sectionid === 105)!;
const stageTeams = stage1.groups[0].teams
  .map((t) => t.pickid)
  .filter((id) => id !== 0)
  .map((id) => layout.teams.find((t) => t.pickid === id)!)
  .map((t) => ({ pickid: t.pickid, name: t.name }));

const html = read("src/fixtures/hltv-stage1-bracket.sample.html");

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

console.log("\nswiss-bracket - parse the live HLTV Stage I bracket HTML");

const raw = parseSwissBracket(html);
const totalMatches = raw.reduce((n, r) => n + r.matches.length, 0);
check("parsed 6 active round columns", raw.length === 6, `got ${raw.length}: ${raw.map((r) => r.label).join(",")}`);
check("first column is 0:0 (Round 1)", raw[0].label === "0:0");
check("parsed 24 matches across the bracket", totalMatches === 24, `got ${totalMatches}`);
check("Round 1 (0:0) has 8 Bo1 matches", (() => {
  const r = raw.find((x) => x.label === "0:0");
  return !!r && r.matches.length === 8 && r.matches.every((m) => m.bestOf === 1);
})());
check("1:0 and 0:1 each have 4 matches", (() => {
  const a = raw.find((x) => x.label === "1:0");
  const b = raw.find((x) => x.label === "0:1");
  return !!a && a.matches.length === 4 && !!b && b.matches.length === 4;
})());

console.log("\nswiss-bracket - scores + winners read straight from the source");

const r1 = raw.find((x) => x.label === "0:0")!;
const findMatch = (rd: typeof r1, a: string, b: string) =>
  rd.matches.find(
    (m) =>
      (m.team1.name === a && m.team2.name === b) || (m.team1.name === b && m.team2.name === a),
  );
check("M80 13-8 Lynn Vision (team1 win)", (() => {
  const m = findMatch(r1, "M80", "Lynn Vision");
  return !!m && m.team1.name === "M80" && m.team1.score === 13 && m.team2.score === 8 && m.team1.winner && !m.team2.winner;
})());
check("SINNERS 14-16 FlyQuest (team2 win, upset)", (() => {
  const m = findMatch(r1, "SINNERS", "FlyQuest");
  return !!m && m.team2.name === "FlyQuest" && m.team2.score === 16 && m.team1.score === 14 && m.team2.winner && !m.team1.winner;
})());
check("BetBoom 13-4 Gaimin Gladiators", (() => {
  const m = findMatch(r1, "BetBoom", "Gaimin Gladiators");
  return !!m && m.team1.score === 13 && m.team2.score === 4 && m.team1.winner;
})());
check("every Round 1 match is marked played with a decided winner",
  r1.matches.every((m) => m.played && (m.team1.winner !== m.team2.winner)));
check("exactly one winner per played match (no double/zero wins)",
  raw.every((rd) => rd.matches.filter((m) => m.played).every((m) => (m.team1.winner ? 1 : 0) + (m.team2.winner ? 1 : 0) === 1)));

console.log("\nswiss-bracket - round classification (advancing / eliminated / contention)");

// Columns are classified by what their matches DECIDE (HLTV/cs.money labeling).
check("0:0 / 1:0 / 0:1 / 1:1 are contention (early progression Bo1s)", ["0:0", "1:0", "0:1", "1:1"].every((l) => bracketRoundKind(l) === "contention"));
check("2:0 / 2:1 are advancing (winner clinches a 3rd win)", ["2:0", "2:1"].every((l) => bracketRoundKind(l) === "advancing"));
check("0:2 / 1:2 are eliminated (loser takes a 3rd loss)", ["0:2", "1:2"].every((l) => bracketRoundKind(l) === "eliminated"));
check("2:2 is BOTH (winner advances, loser eliminated)", bracketRoundKind("2:2") === "both");
check("unparseable label → contention (never falsely 'out')", bracketRoundKind("???") === "contention");
check("2-win format: 1:0 → advancing, 0:1 → eliminated under custom threshold",
  bracketRoundKind("1:0", 2, 2) === "advancing" && bracketRoundKind("0:1", 2, 2) === "eliminated");

console.log("\nswiss-bracket - match every side to the committed Stage I layout");

const matched = matchBracketToLayout(raw, stageTeams);
const allSides = matched.flatMap((r) => r.matches.flatMap((m) => [m.team1, m.team2]));
check("every named side resolved to a layout pickid (logos render)",
  allSides.filter((s) => s.name).every((s) => s.pickid !== null),
  `unmatched: ${[...new Set(allSides.filter((s) => s.name && s.pickid === null).map((s) => s.name))].join(", ") || "none"}`);
check("matched pickids are all in the Stage I pool",
  allSides.filter((s) => s.pickid != null).every((s) => stageTeams.some((t) => t.pickid === s.pickid)));
check("a team's pickid is consistent across rounds (M80 same id in 0:0 and 1:0)", (() => {
  const ids = matched.flatMap((r) => r.matches).flatMap((m) => [m.team1, m.team2]).filter((s) => s.name === "M80").map((s) => s.pickid);
  return ids.length >= 2 && new Set(ids).size === 1 && ids[0] !== null;
})());

console.log("\nswiss-bracket - summary + graceful empty");

const sum = bracketSummary(matched);
check("summary: 24 matches, 16 played at this snapshot (R1+R2 done)", sum.matches === 24 && sum.played === 16, JSON.stringify(sum));
check("summary: 6 rounds", sum.rounds === 6);
check("the live frontier (2:0 / 1:1 / 0:2) is scheduled-not-played — the 'vs ???' state", (() => {
  const frontier = matched.filter((r) => ["2:0", "1:1", "0:2"].includes(r.label));
  return frontier.length === 3 && frontier.every((r) => r.matches.every((m) => !m.played));
})());
check("empty html → [] (graceful, no throw)", parseSwissBracket("").length === 0);
check("html with no bracket → []", parseSwissBracket("<div>nothing here</div>").length === 0);
check("malformed popup json for a cell is skipped, not thrown", (() => {
  const bad = '<div class="swiss-visual-matchups-title">0:0</div><div data-match-details-popup-json="{bad json"></div>';
  return parseSwissBracket(bad).length === 0; // the one bad cell drops → no rounds with matches
})());

console.log(`\nswiss-bracket: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
