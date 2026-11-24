/**
 * verify-swiss-sim — the test that breaks the Swiss simulator (PHA-5453).
 *
 * Replays REAL completed Major Swiss stages from their initial seeds plus the
 * actual winners, and demands that every pairing the engine draws, round by
 * round, equals the pairing that was actually played. Any mismatch means a rule
 * in swiss-sim-core is wrong.
 *
 *   - IEM Cologne Major 2026 Stage 1: seeds = Valve global VRS 2026-05-04 order.
 *   - IEM Cologne Major 2026 Stage 2: seeds 1-8 = invited teams in VRS order,
 *     9-16 = Stage 1 advancers in the final seed order THIS ENGINE computes for
 *     Stage 1 — so the cross-stage seeding rule is replayed too.
 *   - IEM Cologne Major 2026 Stage 3: same rule, off this engine's Stage 2.
 *
 * Plus unit cases for rematch avoidance (rounds 2-3 greedy + rounds 4-5 table)
 * and the Difficulty Score example from the rulebook.
 *
 * Run: node scripts/verify-swiss-sim.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  simulateSwiss,
  nextStageSeeds,
  pairPool,
  matchKey,
  seedCompare,
  type TeamState,
  type SimResult,
} from "../src/lib/swiss-sim-core.ts";
import { vrsWinExpectation } from "../src/lib/vrs-odds-core.ts";
import { buildSimInput, realMatchesFrom } from "../src/lib/swiss-sim-input.ts";
import { preEventSeeding } from "../src/lib/swiss-sim-seeds.ts";
import { parseSwissBracket, matchBracketToLayout } from "../src/lib/swiss-bracket-core.ts";
import type { Layout } from "../src/lib/layout.ts";
import { TEAM_SOURCES } from "../src/lib/team-stats-sources.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
type Match = [string, string, string];
const fx = JSON.parse(readFileSync(join(ROOT, "src/fixtures/swiss-replay-cologne-2026.json"), "utf8")) as {
  stage1: { seeds: string[]; rounds: Record<string, Match[]> };
  stage2: { invited: string[]; rounds: Record<string, Match[]> };
  stage3: { invited: string[]; rounds: Record<string, Match[]> };
};

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a} v ${b}` : `${b} v ${a}`);

function replay(name: string, seeds: string[], real: Record<string, Match[]>): SimResult {
  const winners = new Map<string, string>();
  for (const [r, ms] of Object.entries(real)) for (const [a, b, w] of ms) winners.set(matchKey(+r, a, b), w);
  const sim = simulateSwiss(seeds, (r, a, b) => winners.get(matchKey(r, a, b)) ?? null);
  console.log(`\n${name}`);
  for (let r = 1; r <= 5; r++) {
    const want = new Set((real[String(r)] ?? []).map(([a, b]) => pairKey(a, b)));
    const got = new Set((sim.rounds[r - 1]?.matches ?? []).map((m) => pairKey(m.a, m.b)));
    const same = want.size === got.size && [...want].every((k) => got.has(k));
    check(same, `${name} round ${r}: real {${[...want].join(", ")}} ≠ sim {${[...got].join(", ")}}`);
    console.log(`  round ${r}: ${same ? "✓" : "✗"} ${want.size} match-ups ${same ? "equal" : "DIFFER"}`);
  }
  check(sim.openRound === null, `${name}: stage should be fully decided`);
  return sim;
}

// ── Replays ────────────────────────────────────────────────────────────────
const s1 = replay("IEM Cologne Major 2026 Stage 1", fx.stage1.seeds, fx.stage1.rounds);
const s2seeds = nextStageSeeds(fx.stage2.invited, s1);
console.log(`  Stage 2 seeds 9-16 from Stage 1 final seeds: ${s2seeds.slice(8).join(", ")}`);
const s2 = replay("IEM Cologne Major 2026 Stage 2", s2seeds, fx.stage2.rounds);
const s3seeds = nextStageSeeds(fx.stage3.invited, s2);
console.log(`  Stage 3 seeds 9-16 from Stage 2 final seeds: ${s3seeds.slice(8).join(", ")}`);
replay("IEM Cologne Major 2026 Stage 3", s3seeds, fx.stage3.rounds);

// ── Unit: Bo1/Bo3 assignment ─────────────────────────────────────────────────
{
  const winners = new Map<string, string>();
  for (const [r, ms] of Object.entries(fx.stage1.rounds)) for (const [a, b, w] of ms) winners.set(matchKey(+r, a, b), w);
  const sim = simulateSwiss(fx.stage1.seeds, (r, a, b) => winners.get(matchKey(r, a, b)) ?? null);
  for (const rd of sim.rounds)
    for (const m of rd.matches) {
      const [w, l] = m.record.split(":").map(Number);
      check(m.bestOf === (w === 2 || l === 2 ? 3 : 1), `Bo for ${m.record} should be ${w === 2 || l === 2 ? 3 : 1}`);
    }
}

// ── Unit: rematch avoidance ──────────────────────────────────────────────────
const T = (id: string, seed: number, opp: string[] = []): TeamState => ({
  id, seed, wins: 1, losses: 1, difficulty: 0, opponents: opp,
});
{
  // Round 3, 4-team pool: 1 already played 4 → 1 takes 3 (next-lowest), 2 v 4.
  const pool = [T("A", 1, ["D"]), T("B", 2), T("C", 3), T("D", 4, ["A"])];
  const got = pairPool(pool, 3).map(([a, b]) => `${a.id}${b.id}`);
  check(got.join() === "AC,BD", `greedy rematch skip: got ${got}`);
}
{
  // Round 3: greedy 1v4 then 2v3 would be a rematch (B-C). "available" must
  // look ahead → 1v3, 2v4.
  const pool = [T("A", 1), T("B", 2, ["C"]), T("C", 3, ["B"]), T("D", 4)];
  const got = pairPool(pool, 3).map(([a, b]) => `${a.id}${b.id}`);
  check(got.join() === "AC,BD", `look-ahead rematch skip: got ${got}`);
}
{
  // Round 4, 6-team pool: row 1 (1v6 2v5 3v4) has 1v6 rematch, row 2 also 1v6 →
  // row 3 (1v5 2v6 3v4).
  const pool = [T("A", 1, ["F"]), T("B", 2), T("C", 3), T("D", 4), T("E", 5), T("F", 6, ["A"])];
  const got = pairPool(pool, 4).map(([a, b]) => `${a.id}${b.id}`);
  check(got.join() === "AE,BF,CD", `table row 3: got ${got}`);
}
{
  // Round 4: 1v6, 1v5, 1v4 all rematches → first row with 1v3 is row 9 (1v3 2v6 4v5).
  const pool = [T("A", 1, ["F", "E", "D"]), T("B", 2), T("C", 3), T("D", 4, ["A"]), T("E", 5, ["A"]), T("F", 6, ["A"])];
  const got = pairPool(pool, 4).map(([a, b]) => `${a.id}${b.id}`);
  check(got.join() === "AC,BF,DE", `table row 9: got ${got}`);
}
{
  // No rematch-free pairing possible → still pairs everyone (rulebook: "if possible").
  const pool = [T("A", 1, ["B"]), T("B", 2, ["A"])];
  const got = pairPool(pool, 3).map(([a, b]) => `${a.id}${b.id}`);
  check(got.join() === "AB", `forced rematch: got ${got}`);
}

// ── Unit: Difficulty Score example from the rulebook ─────────────────────────
{
  // "Team A's prior opponents are 2-0 and 1-1 → 2. Team B's are both 1-1 → 0.
  //  Same record → Team A gets the higher seed."
  const a: TeamState = { id: "A", seed: 9, wins: 1, losses: 1, difficulty: 2, opponents: [] };
  const b: TeamState = { id: "B", seed: 1, wins: 1, losses: 1, difficulty: 0, opponents: [] };
  check(seedCompare(a, b) < 0, "higher Difficulty beats better initial seed");
}

// ── Unit: undecided round stops the draw ─────────────────────────────────────
{
  const sim = simulateSwiss(fx.stage1.seeds, () => null);
  check(sim.openRound === 1 && sim.rounds.length === 1, "no results → only round 1 drawn");
}

// ── VRS odds: identical to Valve's own fit.js/glicko.js ──────────────────────
// Reference values produced by running Valve's model/glicko.js @ f8c55f2 with
// fit.js's priorWinExpectation body and defaultGlickoParams.rd = 75.
for (const [a, b, want] of [
  [1564, 1489, 0.6034833894974418],
  [1560, 1466, 0.628643249191746],
  [1960, 1267, 0.9797829625195642],
  [1500, 1500, 0.5],
  [1337, 1598, 0.18822242108016018],
] as const) {
  const got = vrsWinExpectation(a, b);
  check(got !== null && Math.abs(got - want) < 1e-12, `VRS ${a} v ${b}: got ${got}, Valve ${want}`);
}
check(vrsWinExpectation(null, 1500) === null, "missing VRS points → no number");

// ── Singapore 2026 Stage I: committed VRS seeds reproduce the real draw ─────
{
  const layout = (JSON.parse(readFileSync(join(ROOT, "src/fixtures/pgl-singapore-2026-layout.json"), "utf8")) as { result?: Layout } & Layout);
  const L: Layout = layout.result ?? layout;
  // Same HLTV aliasing the live ingest applies (swiss-results.ts withHltvAliases).
  const teams = L.teams.map((t) => {
    const src = TEAM_SOURCES[t.pickid];
    return src ? { pickid: t.pickid, name: t.name, aliases: [src.name, src.slug.replace(/-/g, " ")] } : { pickid: t.pickid, name: t.name };
  });
  const html = readFileSync(join(ROOT, "src/fixtures/hltv-sg-stage1-upcoming.sample.html"), "utf8");
  const rounds = matchBracketToLayout(parseSwissBracket(html), teams);
  const swiss = L.sections.filter((s) => [111, 112, 113].includes(s.sectionid));
  const stageTeams = swiss.map((s) => s.groups.flatMap((g) => g.teams.map((t) => t.pickid)).filter((id) => id > 0));
  const seeding = preEventSeeding(27)!;
  const { input, reason } = buildSimInput({ seeding, stageIndex: 0, stageTeams, stageRounds: [rounds] });
  check(input !== null, `Singapore Stage I sim input: ${reason}`);
  check(realMatchesFrom(rounds).length === 8, "Singapore Stage I: 8 real opening match-ups parsed");
  // Stage II can't be seeded until Stage I is over.
  const s2 = buildSimInput({ seeding, stageIndex: 1, stageTeams, stageRounds: [rounds, []] });
  check(s2.input === null, "Stage II waits for Stage I to finish");
  // A wrong seed order must be caught by the gate, not drawn.
  const swapped = { ...seeding, teams: { ...seeding.teams, 1: [57, 1] as const, 127: [15, 1564] as const } };
  const bad = buildSimInput({ seeding: swapped, stageIndex: 0, stageTeams, stageRounds: [rounds] });
  check(bad.input === null, "wrong seeds are refused by the draw check");
  console.log(`\nSingapore Stage I: VRS 2 Nov 2026 seeds ${input ? "reproduce" : "DO NOT reproduce"} the real opening draw`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
