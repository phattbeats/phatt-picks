/**
 * Swiss simulator input (PHA-5453): turns the live HLTV bracket rounds plus
 * Valve's pre-event seeding into what the client simulator needs — the stage's
 * seed order, the real match-ups + results so far, and each team's VRS points.
 *
 * Seeds (Valve rulebook, "Stage Seeding"):
 *   Stage 1 → the 16 teams in pre-event VRS order.
 *   Stage 2/3 → the stage's directly invited teams (in this section, not in the
 *   previous one) in VRS order as seeds 1-8, then the previous stage's advancers
 *   in their final seed order (record, Difficulty, initial seed) as 9-16 — which
 *   we get by replaying the previous stage's real results through the engine.
 *
 * SAFETY GATE: before handing anything to the UI we replay this stage's real
 * results through the engine and require every real match-up HLTV shows to be
 * one the rules produce. If any differs, our seeds or the source are off and we
 * return null with a reason — the Simulate switch stays hidden rather than draw
 * pairings we can't stand behind.
 *
 * Pure: types only from the bracket core, no I/O.
 */

import type { SwissRound } from "./swiss-bracket-core";
import { simulateSwiss, nextStageSeeds, matchKey, type SimResult } from "./swiss-sim-core";
import type { PreEventSeeding } from "./swiss-sim-seeds";

export interface SimRealMatch {
  round: number;
  a: string;
  b: string;
  winner: string | null;
}

export interface SimStageInput {
  /** Team ids (layout pickid as string) in this stage's seed order. */
  seeds: string[];
  /** Real match-ups (and results where played) from the live source. */
  real: SimRealMatch[];
  /** VRS points by team id, for Valve's expected-win model. */
  points: Record<string, number>;
  seedSource: { label: string; url: string };
}

/** Round number of a W:L column: a team at 1:0 is about to play round 2. */
function roundOfLabel(label: string): number | null {
  const m = label.match(/^(\d+)\s*:\s*(\d+)$/);
  return m ? Number(m[1]) + Number(m[2]) + 1 : null;
}

/** Real match-ups from bracket rounds (only cells with both teams known). */
export function realMatchesFrom(rounds: readonly SwissRound[]): SimRealMatch[] {
  const out: SimRealMatch[] = [];
  for (const r of rounds) {
    const round = roundOfLabel(r.label);
    if (round == null || r.kind !== "contention") continue;
    for (const m of r.matches) {
      const a = m.team1.pickid;
      const b = m.team2.pickid;
      if (a == null || b == null) continue;
      const winner = m.played ? (m.team1.winner ? a : m.team2.winner ? b : null) : null;
      out.push({ round, a: String(a), b: String(b), winner: winner == null ? null : String(winner) });
    }
  }
  return out;
}

export function winnerLookup(real: readonly SimRealMatch[], picks?: ReadonlyMap<string, string>) {
  const known = new Map<string, string>();
  for (const m of real) if (m.winner) known.set(matchKey(m.round, m.a, m.b), m.winner);
  return (round: number, a: string, b: string) => {
    const k = matchKey(round, a, b);
    return known.get(k) ?? picks?.get(k) ?? null;
  };
}

/**
 * Every real match-up must be one the engine draws from the same results.
 * Returns the first offending match-up, or null when all agree.
 */
export function firstMismatch(seeds: readonly string[], real: readonly SimRealMatch[]): string | null {
  const sim = simulateSwiss(seeds, winnerLookup(real));
  for (const m of real) {
    const rd = sim.rounds[m.round - 1];
    if (!rd) {
      // The engine can't draw this round yet (an earlier result is missing) —
      // not a contradiction, just not checkable.
      continue;
    }
    const hit = rd.matches.some((x) => matchKey(m.round, x.a, x.b) === matchKey(m.round, m.a, m.b));
    if (!hit) return `round ${m.round}: ${m.a} v ${m.b}`;
  }
  return null;
}

const byRank = (seeding: PreEventSeeding) => (x: number, y: number) =>
  seeding.teams[x][0] - seeding.teams[y][0];

/**
 * Build the simulator input for the Swiss stage at `stageIndex` (0 = Stage 1).
 *
 * @param stageTeams   pickids per Swiss section, in stage order (from the layout).
 * @param stageRounds  live bracket rounds per Swiss section, in stage order
 *                     (earlier stages are needed to seed Stage 2/3).
 */
export function buildSimInput(args: {
  seeding: PreEventSeeding;
  stageIndex: number;
  stageTeams: readonly (readonly number[])[];
  stageRounds: readonly (readonly SwissRound[] | null)[];
}): { input: SimStageInput | null; reason: string | null } {
  const { seeding, stageIndex, stageTeams, stageRounds } = args;
  let prev: SimResult | null = null;
  let seeds: string[] = [];

  for (let s = 0; s <= stageIndex; s++) {
    const teams = stageTeams[s] ?? [];
    const missing = teams.filter((id) => !seeding.teams[id]);
    if (missing.length > 0) return { input: null, reason: `no VRS seed for pickid ${missing.join(",")}` };
    if (s === 0) {
      seeds = [...teams].sort(byRank(seeding)).map(String);
    } else {
      const before = new Set(stageTeams[s - 1] ?? []);
      const invited = teams.filter((id) => !before.has(id)).sort(byRank(seeding)).map(String);
      if (!prev || prev.openRound !== null) {
        return { input: null, reason: `stage ${s} not finished, can't seed stage ${s + 1}` };
      }
      seeds = nextStageSeeds(invited, prev);
    }
    if (seeds.length !== 16) return { input: null, reason: `stage ${s + 1} has ${seeds.length} seeds, need 16` };

    const real = realMatchesFrom(stageRounds[s] ?? []);
    const bad = firstMismatch(seeds, real);
    if (bad) return { input: null, reason: `stage ${s + 1} draw differs from the rules at ${bad}` };

    if (s === stageIndex) {
      const points: Record<string, number> = {};
      for (const id of seeds) points[id] = seeding.teams[Number(id)][1];
      return { input: { seeds, real, points, seedSource: { label: seeding.label, url: seeding.url } }, reason: null };
    }
    prev = simulateSwiss(seeds, winnerLookup(real));
  }
  return { input: null, reason: "unreachable" };
}
