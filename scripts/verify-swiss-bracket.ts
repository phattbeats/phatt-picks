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
  bracketTerminalRecords,
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

console.log("\nswiss-bracket - round classification by RECORD (3 wins adv / 3 losses elim)");

// Brandon: advancing/eliminated is the 3-0 / 0-3 record, NOT the 2-0 deciding match.
check("still-playing records are contention (0:0 / 1:0 / 0:1 / 2:0 / 1:1 / 0:2 / 2:1 / 1:2 / 2:2)",
  ["0:0", "1:0", "0:1", "2:0", "1:1", "0:2", "2:1", "1:2", "2:2"].every((l) => bracketRoundKind(l) === "contention"));
check("2:0 is NOT advancing (a 2-0 team is still playing)", bracketRoundKind("2:0") === "contention");
check("0:2 is NOT eliminated (a 0-2 team is still alive)", bracketRoundKind("0:2") === "contention");
check("3:0 / 3:1 / 3:2 are advancing (3 wins = through)", ["3:0", "3:1", "3:2"].every((l) => bracketRoundKind(l) === "advancing"));
check("0:3 / 1:3 / 2:3 are eliminated (3 losses = out)", ["0:3", "1:3", "2:3"].every((l) => bracketRoundKind(l) === "eliminated"));
check("unparseable label → contention (never falsely 'out')", bracketRoundKind("???") === "contention");
check("2-win format: 2:0 → advancing, 0:2 → eliminated under custom threshold",
  bracketRoundKind("2:0", 2, 2) === "advancing" && bracketRoundKind("0:2", 2, 2) === "eliminated");

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
check("summary: 0 advanced / 0 eliminated at this snapshot (nobody has 3 W/L yet)",
  sum.advanced === 0 && sum.eliminated === 0, JSON.stringify(sum));
check("no round is mislabeled advancing/eliminated at this snapshot (all contention)",
  matched.every((r) => r.kind === "contention"));
check("the live frontier (2:0 / 1:1 / 0:2) is scheduled-not-played — the 'vs ???' state", (() => {
  const frontier = matched.filter((r) => ["2:0", "1:1", "0:2"].includes(r.label));
  return frontier.length === 3 && frontier.every((r) => r.matches.every((m) => !m.played));
})());
check("every round carries a teams array (terminal columns, empty here)",
  matched.every((r) => Array.isArray(r.teams) && r.teams.length === 0));

console.log("\nswiss-bracket - terminal columns (settled advanced / eliminated teams)");

// Synthetic snapshot of a LATER state: a 3:0 column with a real advanced team +
// an unfilled placeholder, and a 0:3 column with an eliminated team. (Real
// HLTV markup: settled teams sit in a swiss-matchups-team-wrapper as
// <img class="swiss-visual-team-logo" title="TeamName">; "?" = not yet filled.)
const terminalHtml = `
<div class="swiss-visual-matchups-title">3:0</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="BetBoom"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div>
</div>
<div class="swiss-visual-matchups-title">0:3</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="Gaimin Gladiators"></div>
</div>`;
const term = matchBracketToLayout(parseSwissBracket(terminalHtml), stageTeams);
check("parses a 3:0 (advancing) and 0:3 (eliminated) column", (() => {
  const adv = term.find((r) => r.label === "3:0");
  const elim = term.find((r) => r.label === "0:3");
  return !!adv && adv.kind === "advancing" && !!elim && elim.kind === "eliminated";
})());
check("3:0 column lists the advanced team, drops the '?' placeholder", (() => {
  const adv = term.find((r) => r.label === "3:0")!;
  return adv.teams.length === 1 && adv.teams[0].name === "BetBoom" && adv.matches.length === 0;
})());
check("terminal team resolves to a layout pickid (logo renders)", (() => {
  const adv = term.find((r) => r.label === "3:0")!;
  const elim = term.find((r) => r.label === "0:3")!;
  return adv.teams[0].pickid !== null && elim.teams[0].pickid !== null;
})());
check("summary counts settled teams (1 advanced, 1 eliminated)", (() => {
  const s = bracketSummary(term);
  return s.advanced === 1 && s.eliminated === 1;
})());

console.log("\nswiss-bracket - terminal records as the outcome-bridge fallback (PHA-1044)");

// When HLTV reformats the W-L TABLE header (parseHltvSwissStandings → []) but the
// BRACKET still parses, the leaderboard bridge derives each clinched team's exact
// record from the terminal columns instead of silently freezing.
{
  const recs = bracketTerminalRecords(term);
  check("derives a record per settled (pickid-resolved) terminal team", recs.length === 2);
  check("3:0 column → wins 3 / losses 0 for the advanced team", (() => {
    const adv = term.find((r) => r.label === "3:0")!.teams[0];
    const rec = recs.find((x) => x.pickid === adv.pickid);
    return !!rec && rec.wins === 3 && rec.losses === 0;
  })());
  check("0:3 column → wins 0 / losses 3 for the eliminated team", (() => {
    const elim = term.find((r) => r.label === "0:3")!.teams[0];
    const rec = recs.find((x) => x.pickid === elim.pickid);
    return !!rec && rec.wins === 0 && rec.losses === 3;
  })());
}
// The exact label is preserved so the clinch logic can bucket 3:0 vs 3:1/3:2.
{
  const html31 = `
<div class="swiss-visual-matchups-title">3:1</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="Liquid"></div>
</div>`;
  const recs = bracketTerminalRecords(matchBracketToLayout(parseSwissBracket(html31), stageTeams));
  check("a 3:1 advance keeps its non-zero loss (record is 3-1, not 3-0)",
    recs.length === 1 && recs[0].wins === 3 && recs[0].losses === 1);
}
// Contention-only bracket (nobody clinched yet) → no records (bridge no-ops).
check("a contention-only bracket yields zero terminal records",
  bracketTerminalRecords(matched).length === 0);
check("empty bracket → zero records (graceful)", bracketTerminalRecords([]).length === 0);
check("an all-placeholder terminal column yields no teams (stays hidden)", (() => {
  const ph = `<div class="swiss-visual-matchups-title">3:0</div><div class="swiss-matchups-team-wrapper"><div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div></div>`;
  return parseSwissBracket(ph).length === 0;
})());

// PHA-936 regression: HLTV stacks the two terminal boxes of a deciding column by
// emitting BOTH titles consecutively (3:1 then 3:2) and THEN both wrappers in the
// same order — the yesterday-decided 3:1 box is filled, the not-yet-played 3:2
// box is still all "?". Nearest-preceding-title wrongly put the 3:1 teams under
// 3:2 (leaving 3:1 empty). Titles must pair to wrappers positionally.
const stackedHtml = `
<div class="swiss-visual-matchups-title">3:1</div>
<div class="swiss-visual-matchups-title">3:2</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="GamerLegion"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="MIBR"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="M80"></div>
</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div>
</div>
<div class="swiss-visual-matchups-title">1:3</div>
<div class="swiss-visual-matchups-title">2:3</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="THUNDER dOWNUNDER"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="Sharks"></div>
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="HEROIC"></div>
</div>
<div class="swiss-matchups-team-wrapper">
  <div class="swiss-visual-team "><img class="swiss-visual-team-logo" title="?"></div>
</div>`;
const stacked = parseSwissBracket(stackedHtml);
check("stacked deciding column: 3:1 holds the decided advancers (NOT 3:2)", (() => {
  const r31 = stacked.find((r) => r.label === "3:1");
  return !!r31 && r31.teams.map((t) => t.name).join(",") === "GamerLegion,MIBR,M80";
})());
check("stacked deciding column: 3:2 stays empty (no '?'-only round emitted)", () =>
  stacked.find((r) => r.label === "3:2") === undefined);
check("stacked deciding column: 1:3 holds the decided eliminated (NOT 2:3)", (() => {
  const r13 = stacked.find((r) => r.label === "1:3");
  return !!r13 && r13.teams.map((t) => t.name).join(",") === "THUNDER dOWNUNDER,Sharks,HEROIC";
})());
check("stacked deciding column: 2:3 stays empty (fills after today's games)", () =>
  stacked.find((r) => r.label === "2:3") === undefined);

console.log("\nswiss-bracket - graceful empty");

check("empty html → [] (graceful, no throw)", parseSwissBracket("").length === 0);
check("html with no bracket → []", parseSwissBracket("<div>nothing here</div>").length === 0);
check("malformed popup json for a cell is skipped, not thrown", (() => {
  const bad = '<div class="swiss-visual-matchups-title">0:0</div><div data-match-details-popup-json="{bad json"></div>';
  return parseSwissBracket(bad).length === 0; // the one bad cell drops → no rounds with matches
})());

console.log(`\nswiss-bracket: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
