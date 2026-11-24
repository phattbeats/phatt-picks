/**
 * verify-fantasy - offline proof for HOTLINE Fantasy's rules (PHA-5454).
 *
 * Parses two REAL captured HLTV pages (a finished Bo3 match page and an event
 * results page) and proves tiering, lineup validation, match scoring, the
 * late-join rule, the 3-0 bonus, the captain multiplier and manager ranking.
 *
 * Run: node scripts/verify-all.mjs   (or this file alone, see ARCHITECTURE.md)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TIERS,
  buildPool,
  cleanTeamName,
  deriveStageField,
  fantasyStagesFor,
  hltvPlayerIdFromUrl,
  isPlayoffInfo,
  isStageComplete,
  lineupAction,
  lineupGain,
  parseHltvMatchPage,
  parseHltvResultsPage,
  parseLineup,
  playerStageTable,
  rankManagers,
  scoreLineup,
  scoreMatch,
  stagePhase,
  teamRecords,
  validateLineup,
  type FantasyMatchData,
  type FantasyStage,
  type Lineup,
  type PoolTeamInput,
} from "../src/lib/fantasy-core.ts";
import { TEAM_STATS } from "../src/lib/team-stats-core.ts";
import { TEAM_SOURCES } from "../src/lib/team-stats-sources.ts";
import { BASE_EVENTS, sectionsInPlayOrder } from "../src/lib/events-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

/* ── stages ── */
console.log("\nfantasy - stages");
const sg = BASE_EVENTS[27];
const stages = fantasyStagesFor(sectionsInPlayOrder(sg));
check("Singapore has four fantasy stages", stages.length === 4, stages.map((s) => s.short).join(","));
check("Stage I > II > III > Playoffs", stages.map((s) => s.short).join(">") === "Stage I>Stage II>Stage III>Playoffs");
check("playoffs fold QF/SF/GF into one stage keyed by the QF", stages[3].id === 114 && stages[3].sectionIds.join() === "114,115,116");
check("Swiss stage is 16 teams, playoffs 8", stages[0].fieldSize === 16 && stages[3].fieldSize === 8);

/* ── pool ── */
console.log("\nfantasy - Singapore Stage I pool");
const layout = JSON.parse(read("src/fixtures/pgl-singapore-2026-layout.json")).result as {
  teams: { pickid: number; name: string }[];
  sections: { sectionid: number; groups: { teams: { pickid: number }[] }[] }[];
};
const sectionPickids = (id: number) => [
  ...new Set(layout.sections.find((s) => s.sectionid === id)!.groups.flatMap((g) => g.teams.map((t) => t.pickid)).filter((p) => p !== 0)),
];
const teamInput = (pickid: number): PoolTeamInput => ({
  pickid,
  name: layout.teams.find((t) => t.pickid === pickid)!.name,
  hltvTeamId: TEAM_SOURCES[pickid]?.hltvId ?? null,
  worldRank: TEAM_STATS[pickid]?.worldRank ?? null,
  roster: TEAM_STATS[pickid]?.roster ?? [],
});
const stage1Teams = sectionPickids(111);
const pool = buildPool(stage1Teams.map(teamInput));
check("16 teams give 80 players", stage1Teams.length === 16 && pool.length === 80, `${stage1Teams.length} teams, ${pool.length} players`);
check("every Singapore team has an HLTV team id", layout.teams.every((t) => TEAM_SOURCES[t.pickid]?.hltvId), layout.teams.filter((t) => !TEAM_SOURCES[t.pickid]).map((t) => t.name).join(","));
check("all 32 teams give 160 distinct players", buildPool(layout.teams.map((t) => teamInput(t.pickid))).length === 160);
for (const tier of TIERS) check(`${tier} holds 16 players`, pool.filter((p) => p.tier === tier).length === 16);
check("tiers fall with rating", pool.every((p, i) => i === 0 || (pool[i - 1].rating ?? -1) >= (p.rating ?? -1)));
check("player id comes from the HLTV url", hltvPlayerIdFromUrl("https://www.hltv.org/player/10994/stavn") === 10994 && hltvPlayerIdFromUrl("x") === null);

/* ── lineup validation ── */
console.log("\nfantasy - lineup rules");
const pickOne = (tier: string, skipTeams: number[] = []) => pool.find((p) => p.tier === tier && !skipTeams.includes(p.teamPickid))!;
const five = TIERS.map((t) => pickOne(t));
const roles = ["fragger", "survivor", "hitter", "glue", "star"] as const;
const legal: Lineup = { slots: five.map((p, i) => ({ playerId: p.id, role: roles[i] })), captainId: five[4].id };
// The greedy pick above can stack one team; rebuild with at most two per team.
const used = new Map<number, number>();
const spread = TIERS.map((t) => {
  const p = pool.find((q) => q.tier === t && (used.get(q.teamPickid) ?? 0) < 2)!;
  used.set(p.teamPickid, (used.get(p.teamPickid) ?? 0) + 1);
  return p;
});
const good: Lineup = { slots: spread.map((p, i) => ({ playerId: p.id, role: roles[i] })), captainId: spread[4].id };
check("a one-per-tier, two-per-team lineup is legal", validateLineup(good, pool).length === 0, validateLineup(good, pool).join(" | "));
check("four players is refused", validateLineup({ ...good, slots: good.slots.slice(0, 4) }, pool).length > 0);
const twoDiamond: Lineup = { ...good, slots: [...good.slots.slice(0, 4), { playerId: pool.filter((p) => p.tier === "diamond" && p.id !== spread[0].id)[0].id, role: "star" }] };
check("two from one tier is refused", validateLineup(twoDiamond, pool).some((m) => /exactly one/.test(m)));
const team = pool.filter((p) => p.teamPickid === pool[0].teamPickid);
const threeSameTeam = pool.reduce<Map<number, typeof pool>>((m, p) => m.set(p.teamPickid, [...(m.get(p.teamPickid) ?? []), p]), new Map());
const stacked = [...threeSameTeam.values()].find((ps) => new Set(ps.map((p) => p.tier)).size >= 3);
if (stacked) {
  const tiersSeen = new Set<string>();
  const three = stacked.filter((p) => !tiersSeen.has(p.tier) && tiersSeen.add(p.tier)).slice(0, 3);
  const rest = TIERS.filter((t) => !three.some((p) => p.tier === t)).map((t) => pool.find((p) => p.tier === t && p.teamPickid !== three[0].teamPickid)!);
  const l: Lineup = { slots: [...three, ...rest].map((p, i) => ({ playerId: p.id, role: roles[i] })), captainId: three[0].id };
  check("three from one team is refused", validateLineup(l, pool).some((m) => /At most 2/.test(m)), validateLineup(l, pool).join(" | "));
} else check("found a team spanning three tiers to test the cap", false, `${team.length}`);
check("a repeated role is refused", validateLineup({ ...good, slots: good.slots.map((s) => ({ ...s, role: "star" as const })) }, pool).some((m) => /different role/.test(m)));
check("a captain outside the five is refused", validateLineup({ ...good, captainId: 1 }, pool).some((m) => /captain/.test(m)));
check("a player outside the pool is refused", validateLineup({ ...good, slots: [{ playerId: 999999, role: "fragger" }, ...good.slots.slice(1)] }, pool).length > 0);
check("parseLineup rejects junk", parseLineup({ slots: [{ playerId: "x", role: "star" }], captainId: 1 }) === null && parseLineup(null) === null);
check("parseLineup accepts a clean payload", parseLineup(JSON.parse(JSON.stringify(good)))?.slots.length === 5);
check("team names are trimmed and stripped", cleanTeamName("  <b>Emily's   Aces</b>\n ") === "bEmily's Aces/b" && cleanTeamName(5) === "" && cleanTeamName("x".repeat(60)).length === 28);
void legal;

/* ── HLTV match page ── */
console.log("\nfantasy - parse a real finished HLTV match page");
const match = parseHltvMatchPage(read("src/fixtures/hltv-match-finished.sample.html"), 2400529)!;
check("parsed", match != null);
check("teams and headline score", match.team1.name === "BBL" && match.team1.hltvTeamId === 13996 && match.team1.score === 1 && match.team2.name === "SINNERS" && match.team2.score === 2);
check("winner is the side with more maps", match.winnerHltvTeamId === 10577);
check("start time and format", match.startMs === 1795287000000 && match.bestOf === 3);
check("a Swiss line that mentions the playoffs is not a playoff match", !isPlayoffInfo("Best of 3 (LAN) * Swiss round 5 (teams with a 2-2 record). Winner advances to the quarter-finals.") && isPlayoffInfo("Best of 5 (LAN) * Grand final"));
check("info line names the round", /Semi-final/.test(match.info) && isPlayoffInfo(match.info) && !isPlayoffInfo("Best of 1 (LAN) * Swiss round 2"));
check("ten players, five a side", match.players.length === 10 && match.players.filter((p) => p.hltvTeamId === 13996).length === 5);
const nicky = match.players.find((p) => p.id === 24104)!;
check("NickyB line reads 60-57, 86.1 ADR, 66.7% KAST, 1.16", nicky.kills === 60 && nicky.deaths === 57 && nicky.adr === 86.1 && nicky.kast === 66.7 && nicky.rating === 1.16, JSON.stringify(nicky));
check("an unfinished page parses to null", parseHltvMatchPage("<div class=\"countdown\">LIVE</div>", 1) === null);
check("a finished page with no stats yet parses to null", parseHltvMatchPage(read("src/fixtures/hltv-match-finished.sample.html").replace(/id="all-content"/, 'id="x"'), 1) === null);

console.log("\nfantasy - parse a real HLTV results page");
const results = parseHltvResultsPage(read("src/fixtures/hltv-results-event.sample.html"));
check("33 finished matches (a 16-team Swiss stage)", results.length === 33, `${results.length}`);
check("links and ids line up", results.every((r) => r.path.startsWith(`/matches/${r.hltvMatchId}/`)));
check("each result carries its end time", results.every((r) => r.endedMs != null && r.endedMs > 1.7e12));

/* ── scoring ── */
console.log("\nfantasy - score the match");
const scored = scoreMatch(match);
check("placements run 1..10 and pay 100..10", scored.map((s) => s.placementPoints).join() === "100,90,80,70,60,50,40,30,20,10");
check("ratings never rise down the placements", scored.every((s, i) => i === 0 || scored[i - 1].rating >= s.rating));
check("winners get 10, losers 0", scored.every((s) => s.winPoints === (s.hltvTeamId === 10577 ? 10 : 0)));
check("exactly the top three are Stars", scored.filter((s) => s.roleHits.star).length === 3);
check("each team has a Fragger and a Survivor", [13996, 10577].every((t) => scored.some((s) => s.hltvTeamId === t && s.roleHits.fragger) && scored.some((s) => s.hltvTeamId === t && s.roleHits.survivor)));
check("NickyB is BBL's Fragger and a Heavy Hitter, not Glue", (() => { const s = scored.find((x) => x.playerId === 24104)!; return s.roleHits.fragger && s.roleHits.hitter && !s.roleHits.glue; })());

/* ── synthetic stage: late join, 3-0, captain ── */
console.log("\nfantasy - lineup scoring");
const swiss: FantasyStage = { id: 111, name: "Stage I", short: "Stage I", kind: "swiss", sectionIds: [111], fieldSize: 16 };
const A = spread[0]; // diamond
const B = spread[4]; // bronze, captain
const mk = (id: number, startMs: number, winTeam: number, loseTeam: number, top: number[]): FantasyMatchData => ({
  hltvMatchId: id,
  startMs,
  bestOf: 1,
  team1: { hltvTeamId: winTeam, name: `T${winTeam}`, score: 13 },
  team2: { hltvTeamId: loseTeam, name: `T${loseTeam}`, score: 7 },
  winnerHltvTeamId: winTeam,
  info: "Best of 1 (LAN)",
  players: Array.from({ length: 10 }, (_, i) => ({
    id: top[i] ?? 900000 + id * 10 + i,
    nick: `p${i}`,
    hltvTeamId: i < 5 ? winTeam : loseTeam,
    kills: 20 - i,
    deaths: 10 + i,
    adr: 90 - i * 4,
    kast: 80 - i * 2,
    rating: 1.5 - i * 0.1,
  })),
});
const tA = A.hltvTeamId!;
const tB = B.hltvTeamId!;
const T0 = 1_000_000;
// Team A wins three straight; A tops every match. B's team loses once, B is 6th (first of the losers).
const ms = [
  mk(1, T0 + 10, tA, 111111, [A.id]),
  mk(2, T0 + 20, tA, 222222, [A.id]),
  mk(3, T0 + 30, tA, 333333, [A.id]),
  mk(4, T0 + 40, 444444, tB, [0, 0, 0, 0, 0, B.id].map((v, i) => v || 800000 + i)),
];
const ctx = { stage: swiss, stageStartMs: T0, matches: ms, pool };
const early = scoreLineup(good, T0 - 1, ctx);
const sa = early.players.find((p) => p.playerId === A.id)!;
check("three #1 finishes: 300 placement + 30 win", sa.placementPoints === 300 && sa.winPoints === 30);
check("Fragger card pays 25 a match", sa.role === "fragger" && sa.rolePoints === 75);
check("3-0 run pays the 100 bonus", sa.perfectBonus === 100 && sa.total === 505, `${sa.total}`);
const sb = early.players.find((p) => p.playerId === B.id)!;
check("bronze captain doubles: 6th in a loss = 50 x 2.0", sb.captain && sb.multiplier === 2 && sb.base === 50 + sb.rolePoints && sb.total === Math.round(sb.base * 2), JSON.stringify({ base: sb.base, total: sb.total }));
check("lineup total is the sum of its five", early.total === early.players.reduce((n, p) => n + p.total, 0) && early.matchesCounted === 4);
const late = scoreLineup(good, T0 + 25, ctx);
const la = late.players.find((p) => p.playerId === A.id)!;
check("late join scores only matches starting after the save", la.matches.filter((m) => m.counted).length === 1 && la.placementPoints === 100);
check("late join still gets the 3-0 bonus when the clinch came after", la.perfectBonus === 100);
const tooLate = scoreLineup(good, T0 + 35, ctx);
check("joining after the clinch earns no 3-0 bonus", tooLate.players.find((p) => p.playerId === A.id)!.perfectBonus === 0);
check("matches before the stage's scoring start count for nobody", scoreLineup(good, T0 - 1, { ...ctx, stageStartMs: T0 + 15 }).players.find((p) => p.playerId === A.id)!.placementPoints === 200);
check("no bonus in the playoffs", scoreLineup(good, T0 - 1, { ...ctx, stage: { ...swiss, kind: "playoff", fieldSize: 8 } }).players.find((p) => p.playerId === A.id)!.perfectBonus === 0);

console.log("\nfantasy - what new matches add (points push)");
const clinch = lineupGain(good, T0 - 1, ctx, new Set([3]));
check("the clinching match adds placement + win + role + the 3-0 bonus", clinch.gained === 235 && clinch.players.length === 1 && clinch.players[0].playerId === A.id, JSON.stringify(clinch));
const capGain = lineupGain(good, T0 - 1, ctx, new Set([4]));
check("a captain's new match adds his multiplied points", capGain.gained === sb.total && capGain.players[0].playerId === B.id);
check("every match new at once adds the whole score", lineupGain(good, T0 - 1, ctx, new Set([1, 2, 3, 4])).gained === early.total);
check("a match from before a late entry adds nothing", lineupGain(good, T0 + 35, ctx, new Set([3])).gained === 0);
check("a match nobody in the five played adds nothing", lineupGain(good, T0 - 1, ctx, new Set([999])).gained === 0);

console.log("\nfantasy - records, completion, tables");
const rec = teamRecords(ms);
check("team A is 3-0 with its clinch time", rec.get(tA)?.wins === 3 && rec.get(tA)?.losses === 0 && rec.get(tA)?.thirdWinStartMs === T0 + 30);
check("an unfinished Swiss stage is not complete", !isStageComplete(swiss, ms));
check("seven playoff matches complete the bracket", isStageComplete({ ...swiss, kind: "playoff", fieldSize: 8 }, Array.from({ length: 7 }, (_, i) => mk(50 + i, T0 + i, 1, 2, []))));
const table = playerStageTable(ms, T0);
check("player table leads with the 3-0 star", table[0].playerId === A.id && table[0].points === 330 && table[0].matches === 3);

console.log("\nfantasy - standings and phases");
const ranked = rankManagers([
  { managerId: "a", byStage: { 111: 400, 112: 100 } },
  { managerId: "b", byStage: { 111: 500 } },
  { managerId: "c", byStage: { 111: 100, 112: 400 } },
]);
check("level managers share a rank", ranked.map((r) => r.rank).join() === "1,1,1" && ranked[0].total === 500);
check("per-stage ranking", rankManagers([{ managerId: "a", byStage: { 111: 400 } }, { managerId: "b", byStage: { 111: 500 } }], 111).map((r) => r.managerId).join() === "b,a");
check("phase: waiting until the pool is set", stagePhase({ poolReady: false, stageStartMs: null, nowMs: 5, complete: false, frozen: false }) === "waiting");
check("phase: open before the start", stagePhase({ poolReady: true, stageStartMs: 10, nowMs: 5, complete: false, frozen: false }) === "open");
check("phase: live after the start", stagePhase({ poolReady: true, stageStartMs: 10, nowMs: 15, complete: false, frozen: false }) === "live");
check("phase: final when played out", stagePhase({ poolReady: true, stageStartMs: 10, nowMs: 15, complete: true, frozen: false }) === "final");
check("edit while open, one late entry while live, nothing after", lineupAction("open", true) === "edit" && lineupAction("live", false) === "join-late" && lineupAction("live", true) === "none" && lineupAction("final", false) === "none");
const s2 = sectionPickids(112);
check("Stage II's layout still lists 24 candidates", s2.length === 24);
check("Stage II field is not derivable before Stage I ends", deriveStageField({ fieldSize: 16, sectionPickids: s2, previousSectionPickids: stage1Teams, previousAdvancedPickids: [] }) === null);
check("Stage II field = 8 seeds + 8 advancers", deriveStageField({ fieldSize: 16, sectionPickids: s2, previousSectionPickids: stage1Teams, previousAdvancedPickids: stage1Teams.slice(0, 8) })?.length === 16);

console.log(`\nfantasy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
