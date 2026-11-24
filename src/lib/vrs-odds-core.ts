/**
 * Valve Regional Standings (VRS) expected win rate — a line-for-line port of
 * Valve's own model code, not a formula of ours (PHA-5453).
 *
 * Source: ValveSoftware/counter-strike_regional_standings @ f8c55f250fdef796d708aa32814587932154fa04
 *   model/fit.js    — `priorWinExpectation(match)` and `defaultGlickoParams = { rd: 75 }`
 *   model/glicko.js — `Q = ln(10)/400`, `addPendingMatch`, `applyPendingMatches`
 * https://github.com/ValveSoftware/counter-strike_regional_standings/blob/f8c55f250fdef796d708aa32814587932154fa04/model/fit.js
 * https://github.com/ValveSoftware/counter-strike_regional_standings/blob/f8c55f250fdef796d708aa32814587932154fa04/model/glicko.js
 *
 * Valve uses this to score its own model ("Using the difference in point values,
 * each match is then assigned an expected win rate", readme.md). The inputs are
 * the two teams' VRS points. Valve's model makes no Bo1/Bo3 distinction, so
 * neither do we. Pure, no imports.
 */

const Q = Math.log(10) / 400;
const ONE_OVER_PI_SQUARED = 1 / (Math.PI * Math.PI);
/** fit.js defaultGlickoParams.rd — Valve fixes RD, which "converts glicko to elo". */
export const VRS_FIXED_RD = 75;

export const VRS_MODEL_URL =
  "https://github.com/ValveSoftware/counter-strike_regional_standings/blob/f8c55f250fdef796d708aa32814587932154fa04/model/fit.js";

class GlickoTeam {
  rank: number;
  rd: number;
  adjRank = 0;
  adjRDSq = 0;
  constructor(rank: number, rd: number) {
    this.rank = rank;
    this.rd = rd;
  }
  addPendingMatch(other: GlickoTeam, score: number, info = 1.0) {
    const r = this.rank;
    const ro = other.rank;
    const rdo = other.rd;
    const g = 1 / Math.sqrt(1 + 3 * Q * Q * rdo * rdo * ONE_OVER_PI_SQUARED);
    const ev = 1 / (1 + Math.pow(10, (g * (r - ro)) / -400));
    this.adjRDSq += g * g * ev * (1 - ev) * info * info;
    this.adjRank += g * (score - ev) * info;
  }
  applyPendingMatches() {
    const rd = this.rd;
    const adjustedRDSq = 1 / (1 / (rd * rd) + Q * Q * this.adjRDSq);
    this.rank += Q * adjustedRDSq * this.adjRank;
    // clampRD with min = max = fixed RD
    this.rd = VRS_FIXED_RD;
    this.adjRank = 0;
    this.adjRDSq = 0;
  }
}

/**
 * Valve's `priorWinExpectation`: the probability (0..1) that the team with
 * `points1` beats the team with `points2`, or null when either is missing
 * (Valve returns -1, "insufficient data to compare teams").
 */
export function vrsWinExpectation(points1: number | null | undefined, points2: number | null | undefined): number | null {
  if (points1 == null || points2 == null || points1 < 0 || points2 < 0) return null;
  const t1W = new GlickoTeam(points1, VRS_FIXED_RD);
  const t1L = new GlickoTeam(points1, VRS_FIXED_RD);
  const t2 = new GlickoTeam(points2, VRS_FIXED_RD);
  const startingRV = t1W.rank;
  t1W.addPendingMatch(t2, 1);
  t1L.addPendingMatch(t2, 0);
  t1W.applyPendingMatches();
  t1L.applyPendingMatches();
  const winDelta = t1W.rank - startingRV;
  const lossDelta = startingRV - t1L.rank;
  return 1 - winDelta / (winDelta + lossDelta);
}
