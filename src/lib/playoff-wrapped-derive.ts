/**
 * Playoffs Wrapped — storyline auto-derivation (PHA-1274).
 *
 * Brandon: "it needs to check if it's wrapped, start finding the storylines,
 * and go from there." This module is that brain. Given the resolved playoff
 * bracket (the same `PlayoffBracket` the live board already builds), it:
 *
 *   1. checks whether the Major is WRAPPED (a champion has been crowned), and
 *   2. FINDS the storylines from the results — the champion's road through the
 *      bracket, the biggest seed-gap upset (the bracket-buster), and the
 *      lowest-seeded team to run deep (the Cinderella) — and hands back the
 *      `PlayoffWrappedFacts` the deck builder consumes.
 *
 * Nothing here is hand-authored about a *result*: every beat is computed from
 * the bracket + a seed map, so when the live answer key lands Sunday the wrap
 * writes itself. Pure + total — missing data degrades a storyline to "skip it",
 * never to a fabricated team or score. `verify-playoff-wrapped-derive.ts` pins
 * the arithmetic offline.
 */

import type { PlayoffBracket, PlayoffMatch, PlayoffSide } from "./playoff-bracket-core";
import {
  COLOGNE_PHOTOS,
  type PlayoffBracketBuster,
  type PlayoffMoment,
  type PlayoffRunLeg,
  type PlayoffWrappedFacts,
} from "./playoff-wrapped-core";

/** Inputs the bracket can't carry itself: seeds (1 = top) and display names. */
export interface DeriveOptions {
  /** Bracket/global seed for a team (1 = top seed). Drives upset + Cinderella math. */
  seedOf?: (pickId: number) => number | null;
  /** Display name resolver, for derived-moment copy. */
  nameOf?: (pickId: number) => string | null;
}

/** "Is it wrapped?" — the Major is done once the Grand Final has crowned a champion. */
export function isPlayoffWrapped(bracket: PlayoffBracket): boolean {
  return bracket.championPickid != null && bracket.championPickid !== 0;
}

/** The winner/loser sides of a decided match, or null when it isn't cleanly decided. */
function sides(m: PlayoffMatch): { winner: PlayoffSide; loser: PlayoffSide } | null {
  if (!m.decided) return null;
  const winner = m.team1.winner ? m.team1 : m.team2.winner ? m.team2 : null;
  if (!winner || winner.pickid == null) return null;
  const loser = winner === m.team1 ? m.team2 : m.team1;
  return { winner, loser };
}

/** Series score "2-1" from a decided match, or null when scores aren't published. */
function scoreLine(s: { winner: PlayoffSide; loser: PlayoffSide }): string | null {
  return s.winner.score != null && s.loser.score != null ? `${s.winner.score}-${s.loser.score}` : null;
}

/** Every decided match across the bracket, flattened, with winner/loser resolved. */
function decidedMatches(bracket: PlayoffBracket): Array<{
  round: PlayoffMatch;
  key: PlayoffBracket["rounds"][number]["key"];
  winner: PlayoffSide;
  loser: PlayoffSide;
}> {
  const out: Array<{ round: PlayoffMatch; key: PlayoffBracket["rounds"][number]["key"]; winner: PlayoffSide; loser: PlayoffSide }> = [];
  for (const r of bracket.rounds) {
    for (const m of r.matches) {
      const s = sides(m);
      if (s) out.push({ round: m, key: r.key, winner: s.winner, loser: s.loser });
    }
  }
  return out;
}

/** The champion's road, QF → GF: who they beat each round (skips legs with unknown opponents). */
function championRoad(bracket: PlayoffBracket, champ: number): PlayoffRunLeg[] {
  const legs: PlayoffRunLeg[] = [];
  for (const r of bracket.rounds) {
    for (const m of r.matches) {
      const s = sides(m);
      if (!s || s.winner.pickid !== champ || s.loser.pickid == null) continue;
      legs.push({ beatPickId: s.loser.pickid, round: r.key, score: scoreLine(s) });
    }
  }
  return legs;
}

/**
 * The bracket-buster: the decided match with the biggest seed gap where the
 * LOWER seed (numerically larger) won. Needs seeds for both sides; returns null
 * when no seed map is given or no upset exists.
 */
function deriveBuster(bracket: PlayoffBracket, opts: DeriveOptions): PlayoffBracketBuster | null {
  const seedOf = opts.seedOf;
  if (!seedOf) return null;
  let best: { gap: number; winner: PlayoffSide; loser: PlayoffSide } | null = null;
  for (const d of decidedMatches(bracket)) {
    if (d.winner.pickid == null || d.loser.pickid == null) continue;
    const ws = seedOf(d.winner.pickid);
    const ls = seedOf(d.loser.pickid);
    if (ws == null || ls == null) continue;
    const gap = ws - ls; // positive = a lower seed beat a higher one
    if (gap > 0 && (best == null || gap > best.gap)) best = { gap, winner: d.winner, loser: d.loser };
  }
  if (!best) return null;
  const wName = opts.nameOf?.(best.winner.pickid!) ?? `#${best.winner.pickid}`;
  const lName = opts.nameOf?.(best.loser.pickid!) ?? `#${best.loser.pickid}`;
  const score = scoreLine(best);
  return {
    eyebrow: "BRACKET BUSTER",
    headline: `${wName} buried the higher seed.`,
    body: `Seeded #${seedOf(best.winner.pickid!)}, ${wName} knocked out #${seedOf(best.loser.pickid!)} ${lName} — the biggest seed-gap upset of the bracket.`,
    figure: `#${seedOf(best.winner.pickid!)} › #${seedOf(best.loser.pickid!)}`,
    figureCaption: score ? `${wName} ${score} ${lName}` : `${wName} def. ${lName}`,
    winnerPickId: best.winner.pickid!,
    loserPickId: best.loser.pickid!,
  };
}

/** The deepest-running underdog: the worst-seeded team to win at least one match. */
function deriveCinderella(bracket: PlayoffBracket, opts: DeriveOptions): PlayoffMoment | null {
  const seedOf = opts.seedOf;
  if (!seedOf) return null;
  // A team "advanced" if it won any decided match. Pick the worst (highest) seed.
  let worst: { seed: number; pickId: number } | null = null;
  const advanced = new Set<number>();
  for (const d of decidedMatches(bracket)) {
    if (d.winner.pickid != null) advanced.add(d.winner.pickid);
  }
  // Don't crown the champion as the Cinderella here — the champion gets its own
  // slide; the Cinderella is the *other* underdog story.
  for (const pickId of advanced) {
    if (pickId === bracket.championPickid) continue;
    const seed = seedOf(pickId);
    if (seed == null) continue;
    if (worst == null || seed > worst.seed) worst = { seed, pickId };
  }
  if (!worst || worst.seed <= 4) return null; // only a *real* underdog is a story
  const name = opts.nameOf?.(worst.pickId) ?? `#${worst.pickId}`;
  return {
    id: "po-d-cinderella",
    eyebrow: "THE CINDERELLA",
    headline: `${name} crashed the bracket.`,
    figure: `#${worst.seed}`,
    figureCaption: `the #${worst.seed} seed went on a run`,
    body: `Nobody penciled in the #${worst.seed} seed. ${name} won a knockout match they had no business winning and turned the Cathedral upside down.`,
    logoPickIds: [worst.pickId],
    photo: COLOGNE_PHOTOS.player,
  };
}

/**
 * Derive the full `PlayoffWrappedFacts` from a resolved bracket — the "find the
 * storylines and go from there" step. When the bracket isn't wrapped yet, only
 * the cheap totals are filled (no champion, no derived moments); the caller then
 * leans on the curated `COLOGNE_PLAYOFF_MOMENTS` for the mid-bracket recap.
 */
export function derivePlayoffStorylines(bracket: PlayoffBracket, opts: DeriveOptions = {}): PlayoffWrappedFacts {
  const decided = decidedMatches(bracket).length;
  const champ = bracket.championPickid ?? null;
  const facts: PlayoffWrappedFacts = {
    championPickId: champ && champ !== 0 ? champ : null,
    championName: champ ? opts.nameOf?.(champ) ?? null : null,
    totalMatches: bracket.totalMatches,
    decidedMatches: decided,
  };
  if (!isPlayoffWrapped(bracket)) return facts;

  // Champion's road + the Grand Final result.
  facts.championPath = championRoad(bracket, champ!);
  const gf = bracket.rounds.find((r) => r.key === "GF");
  const finalSides = gf?.matches[0] ? sides(gf.matches[0]) : null;
  if (finalSides && finalSides.loser.pickid != null) {
    facts.runnerUpPickId = finalSides.loser.pickid;
    facts.runnerUpName = opts.nameOf?.(finalSides.loser.pickid) ?? null;
    facts.finalScore = scoreLine(finalSides);
  }

  // The two derived storylines: biggest upset + the deepest underdog.
  facts.bracketBuster = deriveBuster(bracket, opts);
  const cinderella = deriveCinderella(bracket, opts);
  facts.moments = cinderella ? [cinderella] : [];

  return facts;
}
