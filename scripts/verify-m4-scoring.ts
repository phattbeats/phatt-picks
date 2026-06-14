/**
 * M4 leaderboard/scoring verification — offline, against the committed layout
 * fixture and a hand-derived known case (scripts/scoring-known-case.json).
 *
 * Proves, by running the real engine (not self-reported), the things the DoD
 * names plus the rules that gate the board:
 *
 *   [1] WEIGHTS & PERFECT TOTAL (rule #3): engine's maxPossibleScore = 135,
 *       split 60 Swiss + 75 playoffs, read from points_per_pick.
 *   [2] KNOWN CASE: a local player (alice) and a connected player (bob) score
 *       to their hand-derived totals (29 and 13) on one board.
 *   [3] FLAT-VALUE-PER-STAGE (rule #3): within a stage every correct pick is
 *       worth that stage's flat weight, independent of slot or result type.
 *   [4] COIN GATE (rule #4): coin shows ONLY for synced && pass && coin;
 *       local players never get a coin/tier.
 *   [5] REVEAL GATE: picks hidden until the stage locks (picks_allowed=false).
 *   [6] OUTCOME NORMALIZATION: only valid (section/group/slot/eligible-team)
 *       results persist; junk is rejected. CC-BY-SA attribution is present.
 *
 * Run:  DATABASE_URL="file:./dev.db" node --env-file=.env scripts/verify-m4-scoring.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSafeJson } from "../src/lib/bigint.ts";
import { scorePlayer, maxPossibleScore, type PlayerPickMap, type OutcomeMap } from "../src/lib/scoring.ts";
import { shouldShowCoin, visibleCoinTier } from "../src/lib/coin-core.ts";
import { isStageLocked, arePicksRevealed } from "../src/lib/reveal-core.ts";
import { normalizeOutcomes, LIQUIPEDIA_ATTRIBUTION } from "../src/lib/outcomes-core.ts";
import type { Layout } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const layout = (parseSafeJson(readFileSync(join(ROOT, "src/fixtures/cologne-layout.json"), "utf8")) as { result: Layout }).result;
const known = JSON.parse(readFileSync(join(ROOT, "scripts/scoring-known-case.json"), "utf8"));

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

type RawPick = { sectionId: number; groupId: number; slotIndex: number; pickId?: number; winnerPickId?: number };

function toPickMap(picks: RawPick[]): PlayerPickMap[string] {
  const m: PlayerPickMap[string] = {};
  for (const p of picks) {
    m[p.sectionId] ??= {};
    m[p.sectionId][p.groupId] ??= {};
    m[p.sectionId][p.groupId][p.slotIndex] = p.pickId!;
  }
  return m;
}

function toOutcomeMap(outcomes: RawPick[]): OutcomeMap {
  const m: OutcomeMap = {};
  for (const o of outcomes) {
    m[o.sectionId] ??= {};
    m[o.sectionId][o.groupId] ??= {};
    m[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId!;
  }
  return m;
}

// [1] weights & perfect total — from the engine, not re-derived by hand.
function proveWeights(): void {
  console.log("\n[1] WEIGHTS & PERFECT TOTAL (rule #3)");
  check("engine maxPossibleScore = 135", maxPossibleScore(layout) === 135, String(maxPossibleScore(layout)));
  const swiss = [105, 106, 107];
  let swissMax = 0;
  let playoffMax = 0;
  for (const s of layout.sections)
    for (const g of s.groups) {
      const m = g.picks.length * g.points_per_pick;
      if (swiss.includes(s.sectionid)) swissMax += m;
      else playoffMax += m;
    }
  check("Swiss max = 60", swissMax === 60, String(swissMax));
  check("Playoff max = 75", playoffMax === 75, String(playoffMax));
}

// [2] known case — one local + one connected player on one board.
function proveKnownCase(): void {
  console.log("\n[2] KNOWN CASE — local (alice) + connected (bob) on one board");
  const outcomes = toOutcomeMap(known.outcomes);
  for (const name of ["alice", "bob"] as const) {
    const p = known.players[name];
    const result = scorePlayer(layout, toPickMap(p.picks), outcomes);
    check(`${name} scores ${p.expectedTotal}`, result.total === p.expectedTotal, `got ${result.total}`);
  }
  // The board ranks them: alice (29) above bob (13).
  const aliceScore = scorePlayer(layout, toPickMap(known.players.alice.picks), outcomes).total;
  const bobScore = scorePlayer(layout, toPickMap(known.players.bob.picks), outcomes).total;
  check("alice ranks above bob", aliceScore > bobScore, `${aliceScore} > ${bobScore}`);
}

// [3] flat-value-per-stage — weight depends on stage, not slot or result type.
function proveFlatValue(): void {
  console.log("\n[3] FLAT-VALUE-PER-STAGE (rule #3)");
  // Stage I (105/271, ppp=1): one correct pick at slot 0 = 1 pt; same at slot 9 = 1 pt.
  const out0: OutcomeMap = { 105: { 271: { 0: 115 } } };
  const out9: OutcomeMap = { 105: { 271: { 9: 74 } } };
  const s0 = scorePlayer(layout, { 105: { 271: { 0: 115 } } }, out0).total;
  const s9 = scorePlayer(layout, { 105: { 271: { 9: 74 } } }, out9).total;
  check("Stage I correct pick = 1 pt (slot 0)", s0 === 1, String(s0));
  check("Stage I correct pick = 1 pt (slot 9) — slot-independent", s9 === 1, String(s9));
  // Stage III (107/273, ppp=3): one correct pick = 3 pts — same rule, higher flat weight.
  const out3: OutcomeMap = { 107: { 273: { 0: 115 } } };
  const s3 = scorePlayer(layout, { 107: { 273: { 0: 115 } } }, out3).total;
  check("Stage III correct pick = 3 pts (flat, higher stage weight)", s3 === 3, String(s3));
}

// [4] coin gate (rule #4).
function proveCoinGate(): void {
  console.log("\n[4] COIN GATE (rule #4)");
  const base = { synced: true, hasViewerPass: true, hasValveCoin: true, coinTier: "gold", isLocal: false };
  check("synced + pass + coin → shows coin", shouldShowCoin(base) && visibleCoinTier(base) === "gold");
  check("local player → NO coin ever", !shouldShowCoin({ ...base, isLocal: true, synced: false }) && visibleCoinTier({ ...base, isLocal: true, synced: false }) === null);
  check("synced + pass, NO coin → hidden", visibleCoinTier({ ...base, hasValveCoin: false, coinTier: null }) === null);
  check("synced + coin, NO pass → hidden", visibleCoinTier({ ...base, hasViewerPass: false }) === null);
  check("pass + coin but NOT synced → hidden", visibleCoinTier({ ...base, synced: false }) === null);
  // Realistic Cologne beta state: synced player, hasViewerPass:false because the
  // write path hasn't probed items yet AND hasValveCoin/coinTier intentionally
  // unset (cutoffs unverified — spec §6). Coin must stay hidden.
  check(
    "synced + hasViewerPass:false (beta realistic state) → hidden",
    visibleCoinTier({ isLocal: false, synced: true, hasViewerPass: false, hasValveCoin: false, coinTier: null }) === null,
  );
}

// [5] reveal gate — picks hidden until lock.
function proveRevealGate(): void {
  console.log("\n[5] REVEAL GATE — picks hidden until stage lock");
  check("open stage (picks_allowed=true) → hidden", !arePicksRevealed({ picks_allowed: true }) && !isStageLocked({ picks_allowed: true }));
  check("locked stage (picks_allowed=false) → revealed", arePicksRevealed({ picks_allowed: false }) && isStageLocked({ picks_allowed: false }));
  check("open stage WITH a resolved outcome → revealed (lock implied)", arePicksRevealed({ picks_allowed: true }, true));
  // The committed layout ships all stages OPEN → everything hidden right now.
  const anyOpen = layout.sections.some((s) => s.groups.some((g) => g.picks_allowed === true));
  check("committed fixture: at least one open stage → live board hides picks", anyOpen);
}

// [6] outcome normalization + attribution.
function proveNormalization(): void {
  console.log("\n[6] OUTCOME NORMALIZATION + ATTRIBUTION");
  const raw = [
    { sectionId: 105, groupId: 271, slotIndex: 0, winnerPickId: 115 }, // valid
    { sectionId: 999, groupId: 271, slotIndex: 0, winnerPickId: 115 }, // bad section
    { sectionId: 105, groupId: 271, slotIndex: 99, winnerPickId: 115 }, // bad slot
    { sectionId: 105, groupId: 271, slotIndex: 1, winnerPickId: 0 }, // unresolved
    { sectionId: 105, groupId: 271, slotIndex: 2, winnerPickId: 99999 }, // ineligible team
  ];
  const { outcomes, rejected } = normalizeOutcomes(layout, raw, "liquipedia");
  check("exactly 1 valid outcome accepted", outcomes.length === 1, `accepted ${outcomes.length}`);
  check("4 junk rows rejected", rejected.length === 4, `rejected ${rejected.length}`);
  check("accepted row tagged source=liquipedia", outcomes[0]?.source === "liquipedia");
  check("CC-BY-SA attribution constant present", /CC-BY-SA/.test(LIQUIPEDIA_ATTRIBUTION), LIQUIPEDIA_ATTRIBUTION);

  // PHA-1109: the HLTV bridge resolves Swiss clinches from the LIVE field, which can
  // be larger than a section's committed per-group roster (Cologne Stage III group
  // 273 carries 8 teams; the live Swiss runs 16). A real clinch by a team in the
  // global roster but not the per-group list (B8 0:3, Spirit 3:0) must score for an
  // HLTV-sourced winner, while Valve / Liquipedia keep the strict per-group check.
  const s3 = layout.sections.find((s) => s.sectionid === 107)!;
  const g3 = s3.groups[0];
  const inGroup = new Set(g3.teams.map((t) => t.pickid));
  const offRoster = layout.teams.find((t) => t.pickid !== 0 && !inGroup.has(t.pickid))!.pickid;
  const bridgeRaw = [{ sectionId: 107, groupId: g3.groupid, slotIndex: 9, winnerPickId: offRoster }];
  check(
    "off-roster live clinch is ACCEPTED for source=hltv (PHA-1109)",
    normalizeOutcomes(layout, bridgeRaw, "hltv").outcomes.length === 1,
    `accepted ${normalizeOutcomes(layout, bridgeRaw, "hltv").outcomes.length}`,
  );
  check(
    "same off-roster winner is still REJECTED for source=valve (strict guard kept)",
    normalizeOutcomes(layout, bridgeRaw, "valve").outcomes.length === 0,
  );
  check(
    "a bogus pickid is rejected even for source=hltv (a real team is still required)",
    normalizeOutcomes(layout, [{ sectionId: 107, groupId: g3.groupid, slotIndex: 8, winnerPickId: 999999 }], "hltv")
      .outcomes.length === 0,
  );
}

console.log("=== HOTLINE M4 leaderboard/scoring verification ===");
proveWeights();
proveKnownCase();
proveFlatValue();
proveCoinGate();
proveRevealGate();
proveNormalization();
console.log(`\n${failures === 0 ? "M4 SCORING CHECKS PASSED" : `M4 SCORING CHECKS FAILED — ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
