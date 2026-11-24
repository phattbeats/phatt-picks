/**
 * Swiss bracket simulator — pure pairing engine (PHA-5453).
 *
 * Everything here is Valve's published Major rules, not ours. Source of truth:
 * ValveSoftware/counter-strike_rules_and_regs, major-supplemental-rulebook.md at
 * commit 621b7d91b0a236044aed62a357fddc863dfaea49 (2026-10-07, the version in
 * force for PGL Major Singapore 2026):
 * https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/621b7d91b0a236044aed62a357fddc863dfaea49/major-supplemental-rulebook.md#swiss-bracket
 *
 * Rule text implemented (quoted verbatim):
 *
 *   ### Swiss Bracket
 *   - Teams play against opponents of identical W-L record.
 *   - Three wins advance---Three losses eliminate
 *   - All elimination and advancement matches are to be best of three.
 *   - All other matches are to be best of one.
 *   - Teams are not to play the same opponent twice in the same stage, if possible.
 *   - Match-ups shall be determined by seed. The first round follows the Initial
 *     Match-ups. In round 2 and 3, the highest seeded team faces the lowest seeded
 *     team available that does not result in a rematch within the stage. In other
 *     rounds, refer to the following table and select the top-most row that does
 *     not result in a rematch:            [PRIORITY_TABLE below, rows 1-15]
 *
 *   ##### Initial Swiss Match-ups
 *   1 vs. 9, 2 vs. 10, 3 vs. 11, 4 vs. 12, 5 vs. 13, 6 vs. 14, 7 vs. 15, 8 vs. 16
 *
 *   #### Stage Seeding
 *   * Stage 1: All teams will use their pre-event seed.
 *   * Stage 2 / Stage 3: The teams directly invited to this stage will be seeds
 *     1-8, and use their pre-event seed. The advancing 8 teams will be seeds 9-16
 *     and use their final seed from the previous stage.
 *   #### Pre-event Seeding
 *   Coming into the event, all 32 teams are sorted based on their current global
 *   standing in the VRS.
 *
 *   ##### Mid-stage Seed Calculation
 *   For all Swiss match-ups, after the initial matches, seed is determined (in
 *   order) by:
 *   1. Current W-L record in the stage
 *   2. Difficulty Score in the current stage
 *   3. Initial seeding of the current stage
 *
 *   ##### Difficulty Score (Buchholz)
 *   The Difficulty Score is the sum of current wins minus the sum of current
 *   losses for every opponent a team has faced.
 *
 * Two readings we had to make, both stated so they can be checked:
 *  - "Current W-L record" ordering: more wins first, then fewer losses. Within a
 *    pairing pool every team has the same record, so it only matters for the
 *    end-of-stage seed handed to the next stage (3-0 > 3-1 > 3-2).
 *  - "lowest seeded team available that does not result in a rematch": a team is
 *    "available" only if the rest of the pool can still be paired without a
 *    rematch (otherwise the greedy pick would strand the bottom of the pool and
 *    force one). When NO rematch-free pairing exists ("if possible"), we fall
 *    back to plain highest-vs-lowest / table row 1.
 * Both are verified by replaying real Major stages round by round
 * (scripts/verify-swiss-sim.ts): every generated pairing must equal the real one.
 *
 * No odds, no probabilities: this module only answers "given these winners, who
 * plays whom next". Pure leaf — no imports — so the verify harness loads it under
 * node and the client bundle stays tiny.
 */

/** Valve's round-4/5 table for a 6-team pool: pairs of in-pool seed positions (1-based). */
export const PRIORITY_TABLE: readonly (readonly [number, number][])[] = [
  [[1, 6], [2, 5], [3, 4]],
  [[1, 6], [2, 4], [3, 5]],
  [[1, 5], [2, 6], [3, 4]],
  [[1, 5], [2, 4], [3, 6]],
  [[1, 4], [2, 6], [3, 5]],
  [[1, 4], [2, 5], [3, 6]],
  [[1, 6], [2, 3], [4, 5]],
  [[1, 5], [2, 3], [4, 6]],
  [[1, 3], [2, 6], [4, 5]],
  [[1, 3], [2, 5], [4, 6]],
  [[1, 4], [2, 3], [5, 6]],
  [[1, 3], [2, 4], [5, 6]],
  [[1, 2], [3, 6], [4, 5]],
  [[1, 2], [3, 5], [4, 6]],
  [[1, 2], [3, 4], [5, 6]],
];

export const WINS_TO_ADVANCE = 3;
export const LOSSES_TO_ELIMINATE = 3;
export const SWISS_ROUNDS = 5;

/** A team id — any stable string (we use the layout pickid as a string). */
export type TeamId = string;

export interface SimMatch {
  /** Higher-seeded side (seed order at the time of pairing). */
  a: TeamId;
  b: TeamId;
  /** "W:L" record both teams carry into the match, e.g. "1:0". */
  record: string;
  /** 1 or 3 — Bo3 when the match can advance or eliminate someone. */
  bestOf: 1 | 3;
  /** Winner when decided (real or picked), else null. */
  winner: TeamId | null;
}

export interface SimRound {
  /** 1-based round number. */
  round: number;
  matches: SimMatch[];
}

export interface TeamState {
  id: TeamId;
  /** Initial seed in this stage (1 = top). */
  seed: number;
  wins: number;
  losses: number;
  /** Buchholz / Difficulty Score against current records. */
  difficulty: number;
  opponents: TeamId[];
}

export interface SimResult {
  rounds: SimRound[];
  teams: Map<TeamId, TeamState>;
  /**
   * The round that is waiting on picks (1-based), or null when the stage is
   * fully decided. Rounds after it can't be drawn yet: the rules seed the next
   * round off EVERY team's record (Difficulty Score), so it needs the whole
   * current round decided.
   */
  openRound: number | null;
}

/** A winner lookup: (round, teamA, teamB) → winner or null. Order-insensitive. */
export type WinnerOf = (round: number, a: TeamId, b: TeamId) => TeamId | null;

/** Order-insensitive key for a match in a given round. */
export function matchKey(round: number, a: TeamId, b: TeamId): string {
  return a < b ? `${round}|${a}|${b}` : `${round}|${b}|${a}`;
}

function recordLabel(t: TeamState): string {
  return `${t.wins}:${t.losses}`;
}

function isActive(t: TeamState): boolean {
  return t.wins < WINS_TO_ADVANCE && t.losses < LOSSES_TO_ELIMINATE;
}

/** Recompute every team's Difficulty Score from current records. */
function refreshDifficulty(teams: Map<TeamId, TeamState>): void {
  for (const t of teams.values()) {
    let d = 0;
    for (const o of t.opponents) {
      const ot = teams.get(o)!;
      d += ot.wins - ot.losses;
    }
    t.difficulty = d;
  }
}

/**
 * Mid-stage seed order: W-L record, then Difficulty Score, then initial seed.
 * Returns a comparator where "less" = higher seed.
 */
export function seedCompare(x: TeamState, y: TeamState): number {
  if (x.wins !== y.wins) return y.wins - x.wins;
  if (x.losses !== y.losses) return x.losses - y.losses;
  if (x.difficulty !== y.difficulty) return y.difficulty - x.difficulty;
  return x.seed - y.seed;
}

const played = (x: TeamState, y: TeamState) => x.opponents.includes(y.id);

/**
 * Rounds 2-3: "the highest seeded team faces the lowest seeded team available
 * that does not result in a rematch". `pool` is in seed order. Returns pairs of
 * pool indices, or null if no rematch-free pairing exists.
 */
function pairHighLow(pool: TeamState[], allowRematch: boolean): [number, number][] | null {
  const used = new Array(pool.length).fill(false);
  const out: [number, number][] = [];
  const solve = (): boolean => {
    const hi = used.indexOf(false);
    if (hi === -1) return true;
    used[hi] = true;
    for (let lo = pool.length - 1; lo > hi; lo--) {
      if (used[lo]) continue;
      if (!allowRematch && played(pool[hi], pool[lo])) continue;
      used[lo] = true;
      out.push([hi, lo]);
      if (solve()) return true;
      out.pop();
      used[lo] = false;
    }
    used[hi] = false;
    return false;
  };
  return solve() ? out : null;
}

/** Rounds 4-5: top-most row of Valve's table with no rematch (6-team pools). */
function pairByTable(pool: TeamState[]): [number, number][] {
  for (const row of PRIORITY_TABLE) {
    if (row.every(([x, y]) => !played(pool[x - 1], pool[y - 1]))) {
      return row.map(([x, y]) => [x - 1, y - 1]);
    }
  }
  // "if possible": no row avoids a rematch → the top-most row.
  return PRIORITY_TABLE[0].map(([x, y]) => [x - 1, y - 1]);
}

/** Pair one record pool for `round`. */
export function pairPool(pool: TeamState[], round: number): [TeamState, TeamState][] {
  let idx: [number, number][];
  if (round >= 4 && pool.length === 6) {
    idx = pairByTable(pool);
  } else {
    idx = pairHighLow(pool, false) ?? pairHighLow(pool, true)!;
  }
  return idx.map(([i, j]) => [pool[i], pool[j]]);
}

/** Bo3 when a win advances or a loss eliminates (Valve: elimination/advancement matches). */
function bestOfFor(t: TeamState): 1 | 3 {
  return t.wins === WINS_TO_ADVANCE - 1 || t.losses === LOSSES_TO_ELIMINATE - 1 ? 3 : 1;
}

/**
 * Run a 16-team Swiss stage from its initial seeds.
 *
 * @param seeds   team ids in seed order (index 0 = seed 1). Must be even-sized.
 * @param winnerOf  result for a given round's match, or null if undecided.
 * @param fixedPairings optional real pairings per round (round → [a,b][]) that
 *   OVERRIDE the computed draw — the live board passes the tournament's actual
 *   published match-ups so the simulator never contradicts the source.
 */
export function simulateSwiss(
  seeds: readonly TeamId[],
  winnerOf: WinnerOf,
  fixedPairings?: ReadonlyMap<number, readonly (readonly [TeamId, TeamId])[]>,
): SimResult {
  const teams = new Map<TeamId, TeamState>();
  seeds.forEach((id, i) =>
    teams.set(id, { id, seed: i + 1, wins: 0, losses: 0, difficulty: 0, opponents: [] }),
  );
  const rounds: SimRound[] = [];
  let openRound: number | null = null;

  for (let round = 1; round <= SWISS_ROUNDS; round++) {
    const active = [...teams.values()].filter(isActive);
    if (active.length === 0) break;

    let pairs: [TeamState, TeamState][];
    const fixed = fixedPairings?.get(round);
    if (fixed && fixed.length > 0) {
      pairs = fixed
        .filter(([a, b]) => teams.has(a) && teams.has(b))
        .map(([a, b]) => {
          const ta = teams.get(a)!;
          const tb = teams.get(b)!;
          return seedCompare(ta, tb) <= 0 ? [ta, tb] : [tb, ta];
        });
    } else if (round === 1) {
      const half = seeds.length / 2;
      pairs = seeds.slice(0, half).map((id, i) => [teams.get(id)!, teams.get(seeds[i + half])!]);
    } else {
      const pools = new Map<string, TeamState[]>();
      for (const t of active.sort(seedCompare)) {
        const k = recordLabel(t);
        if (!pools.has(k)) pools.set(k, []);
        pools.get(k)!.push(t);
      }
      pairs = [];
      for (const pool of pools.values()) pairs.push(...pairPool(pool, round));
    }

    const matches: SimMatch[] = pairs.map(([a, b]) => {
      const w = winnerOf(round, a.id, b.id);
      return {
        a: a.id,
        b: b.id,
        record: recordLabel(a),
        bestOf: bestOfFor(a),
        winner: w === a.id || w === b.id ? w : null,
      };
    });
    rounds.push({ round, matches });

    if (matches.some((m) => m.winner === null)) {
      openRound = round;
      break;
    }
    // Apply results, then recompute Difficulty for the next draw.
    for (const m of matches) {
      const ta = teams.get(m.a)!;
      const tb = teams.get(m.b)!;
      ta.opponents.push(tb.id);
      tb.opponents.push(ta.id);
      const [w, l] = m.winner === m.a ? [ta, tb] : [tb, ta];
      w.wins++;
      l.losses++;
    }
    refreshDifficulty(teams);
  }
  return { rounds, teams, openRound };
}

/** Final seed order of a finished stage (Mid-stage Seed Calculation applied to final records). */
export function finalSeedOrder(result: SimResult): TeamId[] {
  return [...result.teams.values()].sort(seedCompare).map((t) => t.id);
}

/**
 * Next-stage seeds (Stage 2 / 3): directly invited teams are seeds 1-8 in
 * pre-event (VRS) order; the previous stage's advancers are seeds 9-16 in their
 * final seed order from that stage.
 */
export function nextStageSeeds(
  invitedInPreEventOrder: readonly TeamId[],
  previousStage: SimResult,
): TeamId[] {
  const advancers = finalSeedOrder(previousStage).filter(
    (id) => previousStage.teams.get(id)!.wins >= WINS_TO_ADVANCE,
  );
  return [...invitedInPreEventOrder, ...advancers];
}

/** Status of a team after the simulated results. */
export function teamStatus(t: TeamState): "advanced" | "eliminated" | "alive" {
  if (t.wins >= WINS_TO_ADVANCE) return "advanced";
  if (t.losses >= LOSSES_TO_ELIMINATE) return "eliminated";
  return "alive";
}
