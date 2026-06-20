/**
 * verify-playoff-wrapped — offline proof for PHA-1274 (Playoffs Wrapped POC).
 *
 * The Playoffs recap is the *finale* of the Pick'Em, so the builder must be
 * honest about a tournament still in flight (exactly where Cologne sits as this
 * is written). The invariants pinned here:
 *   1. NO CHAMPION → EMPTY DECK. Until the Grand Final has a winner the deck is
 *      `[]` — the same no-op the shell already understands, so the launcher
 *      never auto-opens mid-bracket. Decided QF/SF matches don't unlock it.
 *   2. Signed-out viewer gets cover + champion + run + buster + sign-in outro,
 *      and NO personal slides (no fabricated bracket score).
 *   3. A signed-in viewer adds their bracket score, crowned champion, and rank.
 *   4. "YOU CALLED THE CHAMPION" lights up iff the viewer's title pick is the
 *      real champion — never otherwise.
 *   5. Team logos resolve through the asset fn and unresolved ids drop, never
 *      render blank.
 *
 * Pure module, no DB — exercises playoff-wrapped-core directly.
 * Run: node scripts/verify-playoff-wrapped.ts
 */

import {
  buildPlayoffWrappedDeck,
  playoffWrappedHasContent,
  type PlayoffWrappedAssets,
  type PlayoffWrappedFacts,
  type PlayoffWrappedPersonal,
} from "../src/lib/playoff-wrapped-core.ts";

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

// A tiny logo table for the Cologne field (pickId → name). Only these resolve.
const NAMES: Record<number, string> = {
  85: "FURIA",
  89: "Vitality",
  112: "9z Team",
  134: "Aurora",
  137: "BetBoom",
  139: "Falcons",
};
const assets: PlayoffWrappedAssets = {
  resolveTeamLogo: (id) => (NAMES[id] ? { tiers: [], name: NAMES[id] } : null),
  majorLogoSrc: "/watch/iem-cologne.png",
  gameLogoSrc: "/watch/counter-strike.png",
};

// ---- Invariant 1: no champion → empty deck (even with decided early rounds). ----
const inFlight: PlayoffWrappedFacts = { championPickId: null, totalMatches: 7, decidedMatches: 5 };
check("no champion → hasContent false", !playoffWrappedHasContent(inFlight));
check("no champion → empty deck", buildPlayoffWrappedDeck(inFlight, null, assets).length === 0);
check("champion 0 treated as undecided", buildPlayoffWrappedDeck({ ...inFlight, championPickId: 0 }, null, assets).length === 0);
// Even a fully personalized viewer gets nothing before the Final lands.
const earlyPersonal: PlayoffWrappedPersonal = {
  displayName: "DJCeee",
  bracketHits: 3,
  bracketResolved: 5,
  championPickId: 85,
};
check("no champion → empty even with personal", buildPlayoffWrappedDeck(inFlight, earlyPersonal, assets).length === 0);

// ---- The resolved bracket: FURIA champions over Vitality, 9z the buster. ----
const resolved: PlayoffWrappedFacts = {
  championPickId: 85,
  runnerUpPickId: 89,
  finalScore: "3-1",
  championPath: [
    { beatPickId: 112, round: "QF", score: "2-0" },
    { beatPickId: 137, round: "SF", score: "2-1" },
    { beatPickId: 89, round: "GF", score: "3-1" },
  ],
  bracketBuster: {
    headline: "9z bulldozed the top seed.",
    body: "World #13 9z knocked Vitality out of the Quarterfinal nobody had circled.",
    winnerPickId: 112,
    loserPickId: 89,
    figureCaption: "9z 2-1 Vitality",
  },
  totalMatches: 7,
  decidedMatches: 7,
};

// ---- Invariant 2: signed-out deck shape. ----
const out = buildPlayoffWrappedDeck(resolved, null, assets);
const outIds = out.map((s) => s.id);
check("resolved → non-empty deck", out.length > 0);
check("signed-out has cover", outIds[0] === "po-intro");
check("signed-out has champion slide", outIds.includes("po-champion"));
check("signed-out has the run", outIds.includes("po-run"));
check("signed-out has the buster", outIds.includes("po-buster"));
check("signed-out has NO personal slides", !outIds.some((id) => id.startsWith("po-your") || id === "po-rank" || id === "po-bleachers"));
check("signed-out outro prompts sign-in", out[out.length - 1].id === "po-outro" && /sign in/i.test(out[out.length - 1].body ?? ""));
check("champion slide names FURIA", /FURIA/.test(out.find((s) => s.id === "po-champion")?.headline ?? ""));
check("champion slide carries the trophy figure", out.find((s) => s.id === "po-champion")?.figure === "🏆");
check("run slide lists beaten teams", /9z Team/.test(out.find((s) => s.id === "po-run")?.body ?? "") && /Vitality/.test(out.find((s) => s.id === "po-run")?.body ?? ""));

// ---- Invariant 5: logos resolve, unknown ids drop. ----
const champLogos = out.find((s) => s.id === "po-champion")?.teamLogos ?? [];
check("champion logo resolved", champLogos.length === 1 && champLogos[0].name === "FURIA");
const noAssetDeck = buildPlayoffWrappedDeck(resolved, null, {});
check("no resolver → text-only deck still valid", noAssetDeck.length === out.length && (noAssetDeck.find((s) => s.id === "po-champion")?.teamLogos ?? undefined) === undefined);
// An unknown beaten team drops out of the run logo row but stays in the copy fallback.
const oddPath = buildPlayoffWrappedDeck(
  { ...resolved, championPath: [{ beatPickId: 999, round: "QF" }, { beatPickId: 137, round: "SF" }] },
  null,
  assets,
);
check("unresolved run team drops from logo row", (oddPath.find((s) => s.id === "po-run")?.teamLogos ?? []).length === 1);
check("unresolved run team falls back to #id in copy", /#999/.test(oddPath.find((s) => s.id === "po-run")?.body ?? ""));

// ---- Invariant 3 + 4: personal deck, champion matched. ----
const matchedPersonal: PlayoffWrappedPersonal = {
  displayName: "DJCeee",
  avatar: { src: null, label: "DJCeee" },
  bracketHits: 6,
  bracketResolved: 7,
  championPickId: 85, // == real champion
  rankAfter: 3,
  rankMove: { delta: 4, direction: "up" },
  reactionsPlaced: 9,
};
const mine = buildPlayoffWrappedDeck(resolved, matchedPersonal, assets);
const mineIds = mine.map((s) => s.id);
check("personal deck adds your-bracket", mineIds.includes("po-your-bracket"));
check("personal deck adds your-champion", mineIds.includes("po-your-champion"));
check("personal deck adds bleachers (reactions placed)", mineIds.includes("po-bleachers"));
check("personal deck adds rank", mineIds.includes("po-rank"));
check("your-bracket shows hit ratio", mine.find((s) => s.id === "po-your-bracket")?.figure === "6/7");
const yourChamp = mine.find((s) => s.id === "po-your-champion");
check("matched champion lights YOU CALLED THE CHAMPION", yourChamp?.calledIt?.label === "YOU CALLED THE CHAMPION");
check("matched champion headline reads 'crowned'", /crowned/i.test(yourChamp?.headline ?? ""));
check("rank slide shows upward move", mine.find((s) => s.id === "po-rank")?.figure === "▲4");
check("personal outro does NOT prompt sign-in", !/sign in/i.test(mine[mine.length - 1].body ?? ""));

// ---- Invariant 4 (negative): wrong title pick must NOT light the reward. ----
const missedPersonal: PlayoffWrappedPersonal = {
  displayName: "Emily",
  bracketHits: 2,
  bracketResolved: 7,
  championPickId: 139, // Falcons — not the champion
  rankAfter: 20,
  rankMove: { delta: 0, direction: "flat" },
};
const missed = buildPlayoffWrappedDeck(resolved, missedPersonal, assets);
const missedChamp = missed.find((s) => s.id === "po-your-champion");
check("wrong title pick → no reward", missedChamp?.calledIt === undefined);
check("wrong title pick headline reads 'had'", /had/i.test(missedChamp?.headline ?? ""));
check("no reactions → no bleachers slide", !missed.some((s) => s.id === "po-bleachers"));

console.log(`\nverify-playoff-wrapped: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
