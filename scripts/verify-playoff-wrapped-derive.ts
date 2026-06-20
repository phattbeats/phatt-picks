/**
 * verify-playoff-wrapped-derive — offline proof for PHA-1274's storyline brain.
 *
 * Brandon: "it needs to check if it's wrapped, start finding the storylines,
 * and go from there." This pins that the derivation is honest arithmetic over a
 * resolved bracket — no hand-authored results:
 *   1. isPlayoffWrapped is true only once a champion is crowned.
 *   2. Not wrapped → only totals, no champion path / derived moments.
 *   3. Wrapped → the champion's road (QF→GF, who they beat + scores), the
 *      Grand Final runner-up + score, the biggest seed-gap upset, and the
 *      worst-seeded underdog — all computed from the bracket + seed map.
 *   4. The derived facts flow straight into buildPlayoffWrappedDeck.
 *   5. No seed map → seed-based storylines (buster/Cinderella) gracefully drop.
 *
 * Run: node scripts/verify-playoff-wrapped-derive.ts
 */

import type { PlayoffBracket, PlayoffMatch, PlayoffRound, PlayoffSide } from "../src/lib/playoff-bracket-core.ts";
import { derivePlayoffStorylines, isPlayoffWrapped } from "../src/lib/playoff-wrapped-derive.ts";
import { buildPlayoffWrappedDeck } from "../src/lib/playoff-wrapped-core.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name);
  }
}

// ---- Cologne field: names + seeds. ----
const NAMES: Record<number, string> = {
  85: "FURIA", 89: "Vitality", 81: "Team Spirit", 139: "Falcons",
  134: "Aurora", 59: "G2", 137: "BetBoom", 112: "9z Team",
};
const SEED: Record<number, number> = { 85: 1, 89: 2, 81: 3, 139: 4, 134: 5, 59: 6, 137: 7, 112: 8 };
const opts = { seedOf: (id: number) => SEED[id] ?? null, nameOf: (id: number) => NAMES[id] ?? null };

// ---- Build a resolved bracket by hand (matches the live PlayoffBracket shape). ----
function side(pickid: number, score: number | null, winner: boolean): PlayoffSide {
  return { pickid, score, winner, userPicked: false };
}
function match(groupId: number, label: string, w: PlayoffSide, l: PlayoffSide, decided: boolean): PlayoffMatch {
  return { groupId, label, team1: w, team2: l, seeded: true, decided, userResult: null, scheduledAtIso: null };
}
function round(key: PlayoffRound["key"], sectionId: number, matches: PlayoffMatch[]): PlayoffRound {
  return { key, label: key, short: key, sectionId, matches };
}

// QF: 85>134, 112>137 (s8 over s7), 81>59, 139>89 (s4 over s2 — the upset).
// SF: 85>112, 81>139.  GF: 85>81 → FURIA champion, Spirit runner-up 3-1.
const qf = round("QF", 108, [
  match(274, "M1", side(85, 2, true), side(134, 0, false), true),
  match(275, "M2", side(112, 2, true), side(137, 1, false), true),
  match(276, "M3", side(81, 2, true), side(59, 0, false), true),
  match(277, "M4", side(139, 2, true), side(89, 1, false), true),
]);
const sf = round("SF", 109, [
  match(278, "M1", side(85, 2, true), side(112, 0, false), true),
  match(279, "M2", side(81, 2, true), side(139, 1, false), true),
]);
const gf = round("GF", 110, [match(280, "Final", side(85, 3, true), side(81, 1, false), true)]);
const wrapped: PlayoffBracket = {
  rounds: [qf, sf, gf],
  anySeeded: true,
  anyDecided: true,
  totalMatches: 7,
  championPickid: 85,
};

// ---- Invariant 1 + 2: the "is it wrapped?" gate. ----
check("wrapped bracket → isPlayoffWrapped true", isPlayoffWrapped(wrapped));
const live: PlayoffBracket = { ...wrapped, championPickid: null, rounds: [qf, sf, round("GF", 110, [match(280, "Final", side(0, null, false), side(0, null, false), false)])] };
check("undecided GF → isPlayoffWrapped false", !isPlayoffWrapped(live));
const liveFacts = derivePlayoffStorylines(live, opts);
check("not wrapped → no champion", liveFacts.championPickId === null);
check("not wrapped → no champion path", liveFacts.championPath === undefined);
check("not wrapped → no derived moments", liveFacts.moments === undefined);
check("not wrapped → still counts decided matches", liveFacts.decidedMatches === 6);

// ---- Invariant 3: full derivation from the resolved bracket. ----
const f = derivePlayoffStorylines(wrapped, opts);
check("champion derived", f.championPickId === 85 && f.championName === "FURIA");
check("decided matches counted", f.decidedMatches === 7 && f.totalMatches === 7);
// Champion road: QF beat 134, SF beat 112, GF beat 81 — in order, with scores.
check("champion road has 3 legs", (f.championPath ?? []).length === 3);
check("champion road is QF→SF→GF order", f.championPath?.[0].round === "QF" && f.championPath?.[1].round === "SF" && f.championPath?.[2].round === "GF");
check("champion road names who they beat", f.championPath?.[0].beatPickId === 134 && f.championPath?.[2].beatPickId === 81);
check("champion road carries scores", f.championPath?.[2].score === "3-1");
// Grand Final result.
check("runner-up derived", f.runnerUpPickId === 81 && f.runnerUpName === "Team Spirit");
check("final score derived", f.finalScore === "3-1");
// Bracket-buster: biggest seed gap upset = 139 (s4) over 89 (s2), gap 2.
check("bracket-buster is the biggest seed-gap upset", f.bracketBuster?.winnerPickId === 139 && f.bracketBuster?.loserPickId === 89);
check("bracket-buster figure shows the seed gap", f.bracketBuster?.figure === "#4 › #2");
// Cinderella: worst-seeded non-champion to win a match = 9z (#8).
check("Cinderella is the worst-seeded advancer (not the champion)", f.moments?.[0]?.logoPickIds?.[0] === 112);
check("Cinderella reads as #8 seed", f.moments?.[0]?.figure === "#8");
check("Cinderella carries a photo", !!f.moments?.[0]?.photo?.src);

// ---- Invariant 4: derived facts flow into the deck builder. ----
const assets = { resolveTeamLogo: (id: number) => (NAMES[id] ? { tiers: [], name: NAMES[id] } : null) };
const deck = buildPlayoffWrappedDeck(f, null, assets);
const ids = deck.map((s) => s.id);
check("derived deck has champion slide", ids.includes("po-champion"));
check("derived deck has the run", ids.includes("po-run"));
check("derived deck has the buster", ids.includes("po-buster"));
check("derived deck has the Cinderella moment", ids.includes("po-d-cinderella"));
check("derived champion slide names FURIA", /FURIA/.test(deck.find((s) => s.id === "po-champion")?.headline ?? ""));

// ---- Invariant 5: no seed map → seed-based storylines drop, champion still derived. ----
const noSeed = derivePlayoffStorylines(wrapped, { nameOf: opts.nameOf });
check("no seed map → champion still derived", noSeed.championPickId === 85);
check("no seed map → no bracket-buster", noSeed.bracketBuster == null);
check("no seed map → no Cinderella moment", (noSeed.moments ?? []).length === 0);

console.log(`\nverify-playoff-wrapped-derive: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
