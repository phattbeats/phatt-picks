/**
 * PHA-918 — Live leaderboard / Swiss-clinch bridge verification (offline).
 *
 * Proves, by running the real engines against the committed layout fixture:
 *
 *   [1] CLINCH BUCKETS: pickBucketForRecord maps terminal W-L records to the
 *       right pick bucket (3:0 / advance / 0:3) and leaves non-terminal records
 *       — still playing, or eliminated 1:3 / 2:3 (out, but NOT the 0:3 pick
 *       bucket) — unresolved. We never invent a result.
 *   [2] BRIDGE: deriveClinchedSlots assigns clinched teams to free bucket slots,
 *       is idempotent + terminal (re-run never rewrites a filled slot, only
 *       appends newly-clinched teams), and is bucket-aware (slot choice within a
 *       bucket doesn't matter to scoring).
 *   [3] BUCKET-AWARE SCORING: scorePlayer scores Swiss buckets as sets — order
 *       within a bucket is irrelevant; points are monotonic and never exceed
 *       possible; playoffs stay strict per-slot.
 *   [4] REGRESSION: the M4 known case (alice 29, bob 13) and flat-value-per-stage
 *       still hold under the bucket-aware scorer.
 *   [5] LIVE CASE: against the real IEM Cologne Stage I result (BetBoom + B8 →
 *       3:0, SINNERS + Gaimin Gladiators → 0:3), the bridge + scorer reproduce
 *       the hand-checked standings — a player who called B8 3:0 and SINNERS 0:3
 *       scores 2, a single-correct caller scores 1.
 *
 * Run: node scripts/verify-live-leaderboard.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  pickBucketForRecord,
  pickBucketForLabel,
  deriveClinchedSlots,
  type ClinchInput,
} from "../src/lib/swiss-clinch-core.ts";
import { bucketSwissSlots } from "../src/lib/swiss-bucket-core.ts";
import { scorePlayer, type OutcomeMap, type PlayerPickMap } from "../src/lib/scoring.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;
const stage1: Section = layout.sections.find((s) => s.sectionid === 105)!;
const G = stage1.groups[0].groupid; // 271
const teamIds = stage1.groups[0].teams.map((t) => t.pickid).filter((id) => id !== 0);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name + (detail ? "  — " + detail : ""));
  }
}

// Turn bridge rows into an OutcomeMap the scorer reads.
function toOutcomeMap(
  rows: { groupId: number; slotIndex: number; winnerPickId: number }[],
  sectionId = 105,
): OutcomeMap {
  const m: OutcomeMap = {};
  for (const r of rows) {
    m[sectionId] ??= {};
    m[sectionId][r.groupId] ??= {};
    m[sectionId][r.groupId][r.slotIndex] = r.winnerPickId;
  }
  return m;
}

// ── [1] clinch buckets ───────────────────────────────────────────────────────
console.log("\n[1] CLINCH BUCKETS — terminal record → pick bucket");
check("3-0 → 3-0 bucket", pickBucketForRecord(3, 0) === "3-0");
check("3-1 → advance bucket", pickBucketForRecord(3, 1) === "advance");
check("3-2 → advance bucket", pickBucketForRecord(3, 2) === "advance");
check("0-3 → 0-3 bucket", pickBucketForRecord(0, 3) === "0-3");
check("1-3 → null (out, not a pick bucket)", pickBucketForRecord(1, 3) === null);
check("2-3 → null (out, not a pick bucket)", pickBucketForRecord(2, 3) === null);
check("2-1 → null (still playing)", pickBucketForRecord(2, 1) === null);
check("1-2 → null (still playing)", pickBucketForRecord(1, 2) === null);
check("label '3:0 ADVANCED' → 3-0", pickBucketForLabel("3:0 ADVANCED") === "3-0");
check("label '3:1 / 3:2 ADVANCED' → advance", pickBucketForLabel("3:1 / 3:2 ADVANCED") === "advance");
check("label '0:3 ELIMINATED' → 0-3", pickBucketForLabel("0:3 ELIMINATED") === "0-3");

// ── [2] bridge derivation ────────────────────────────────────────────────────
console.log("\n[2] BRIDGE — deriveClinchedSlots assignment / idempotency");
// Two 3-0, two 0-3, rest still playing.
const [a, b, c, d, e, f] = teamIds; // arbitrary real pickids
const standings1: ClinchInput[] = [
  { pickid: a, wins: 3, losses: 0 },
  { pickid: b, wins: 3, losses: 0 },
  { pickid: c, wins: 0, losses: 3 },
  { pickid: d, wins: 0, losses: 3 },
  { pickid: e, wins: 2, losses: 1 }, // still playing — not written
  { pickid: f, wins: 1, losses: 3 }, // out 1:3 — not a pick bucket
];
const r1 = deriveClinchedSlots(stage1, standings1, [], bucketSwissSlots);
check("resolves exactly 4 slots (2×3-0 + 2×0-3)", r1.length === 4, String(r1.length));
const slots30 = r1.filter((r) => [0, 1].includes(r.slotIndex)).map((r) => r.winnerPickId).sort();
const slots03 = r1.filter((r) => [8, 9].includes(r.slotIndex)).map((r) => r.winnerPickId).sort();
check("3-0 teams placed in slots 0/1", JSON.stringify(slots30) === JSON.stringify([a, b].sort()));
check("0-3 teams placed in slots 8/9", JSON.stringify(slots03) === JSON.stringify([c, d].sort()));
check("still-playing / 1:3 teams NOT written", !r1.some((r) => r.winnerPickId === e || r.winnerPickId === f));

// Idempotency: feeding the same standings back with the prior rows as `existing`
// resolves nothing new.
const r1b = deriveClinchedSlots(stage1, standings1, r1, bucketSwissSlots);
check("re-run with existing rows → 0 new (idempotent/terminal)", r1b.length === 0, String(r1b.length));

// Append: a later advance clinch lands in a free advance slot, leaving the
// already-filled 3-0/0-3 slots untouched.
const standings2: ClinchInput[] = [...standings1, { pickid: e, wins: 3, losses: 1 }];
const r2 = deriveClinchedSlots(stage1, standings2, r1, bucketSwissSlots);
check("new advance clinch → 1 new row in slots 2-7", r2.length === 1 && r2[0].slotIndex >= 2 && r2[0].slotIndex <= 7, JSON.stringify(r2));
check("append does not touch filled 3-0/0-3 slots", r2.every((r) => ![0, 1, 8, 9].includes(r.slotIndex)));

// ── [3] bucket-aware scoring ─────────────────────────────────────────────────
console.log("\n[3] BUCKET-AWARE SCORING — order within a bucket is irrelevant");
// Outcome: 3-0 = {a,b} in slots 0,1. Player tags a,b for 3-0 but in SWAPPED slots.
const outBucket = toOutcomeMap([
  { groupId: G, slotIndex: 0, winnerPickId: a },
  { groupId: G, slotIndex: 1, winnerPickId: b },
]);
const swapped: PlayerPickMap[string] = { 105: { [G]: { 0: b, 1: a } } }; // swapped order
const sSwap = scorePlayer(layout, swapped, outBucket);
check("both 3-0 picks score despite swapped slots", sSwap.total === 2, String(sSwap.total));
check("possible reflects 2 resolved 3-0 slots", sSwap.bySection.find((x) => x.sectionId === 105)!.possible === 2);
// One right, one wrong-bucket team.
const oneRight: PlayerPickMap[string] = { 105: { [G]: { 0: a, 1: 999999 } } };
check("one correct 3-0 pick scores 1", scorePlayer(layout, oneRight, outBucket).total === 1);
// Points never exceed possible.
const allWrong: PlayerPickMap[string] = { 105: { [G]: { 0: 111111, 1: 222222 } } };
const sw = scorePlayer(layout, allWrong, outBucket);
check("no correct picks → 0 points, possible still 2", sw.total === 0 && sw.bySection.find((x) => x.sectionId === 105)!.possible === 2);

// ── [4] regression: M4 known case + flat value ───────────────────────────────
console.log("\n[4] REGRESSION — M4 known case (alice 29, bob 13) + flat value");
const known = JSON.parse(read("scripts/scoring-known-case.json")) as {
  outcomes: { sectionId: number; groupId: number; slotIndex: number; winnerPickId: number }[];
  players: Record<string, { expectedTotal: number; picks: { sectionId: number; groupId: number; slotIndex: number; pickId: number }[] }>;
};
const knownOut: OutcomeMap = {};
for (const o of known.outcomes) {
  knownOut[o.sectionId] ??= {};
  knownOut[o.sectionId][o.groupId] ??= {};
  knownOut[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
}
function toPickMap(picks: { sectionId: number; groupId: number; slotIndex: number; pickId: number }[]): PlayerPickMap[string] {
  const m: PlayerPickMap[string] = {};
  for (const p of picks) {
    m[p.sectionId] ??= {};
    m[p.sectionId][p.groupId] ??= {};
    m[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }
  return m;
}
for (const name of ["alice", "bob"]) {
  const p = known.players[name];
  const got = scorePlayer(layout, toPickMap(p.picks), knownOut).total;
  check(`${name} scores ${p.expectedTotal} (bucket-aware)`, got === p.expectedTotal, String(got));
}
// Flat-value-per-stage: a single correct pick is worth the stage weight regardless of slot/bucket.
check("Stage I correct pick = 1 pt (slot 0)", scorePlayer(layout, { 105: { [G]: { 0: a } } }, toOutcomeMap([{ groupId: G, slotIndex: 0, winnerPickId: a }])).total === 1);
check("Stage I correct pick = 1 pt (slot 9, 0-3 bucket)", scorePlayer(layout, { 105: { [G]: { 9: c } } }, toOutcomeMap([{ groupId: G, slotIndex: 9, winnerPickId: c }])).total === 1);

// ── [5] live case — real Stage I result ──────────────────────────────────────
console.log("\n[5] LIVE CASE — real IEM Cologne Stage I (3:0 BetBoom+B8, 0:3 SINNERS+Gaimin)");
// Real layout pickids: BetBoom 137, B8 135, SINNERS 147, Gaimin Gladiators 146.
const BETBOOM = 137, B8 = 135, SINNERS = 147, GAIMIN = 146;
const liveStandings: ClinchInput[] = [
  { pickid: BETBOOM, wins: 3, losses: 0 },
  { pickid: B8, wins: 3, losses: 0 },
  { pickid: SINNERS, wins: 0, losses: 3 },
  { pickid: GAIMIN, wins: 0, losses: 3 },
];
const liveRows = deriveClinchedSlots(stage1, liveStandings, [], bucketSwissSlots);
const liveOut = toOutcomeMap(liveRows);
check("live bridge resolves 4 slots", liveRows.length === 4, String(liveRows.length));
// Brandolorian: NRG + B8 for 3-0, SINNERS + THUNDER for 0-3 → B8 ✓ + SINNERS ✓ = 2.
const brando: PlayerPickMap[string] = { 105: { [G]: { 0: 999001, 1: B8, 8: SINNERS, 9: 999002 } } };
check("Brandolorian (B8 3:0 ✓, SINNERS 0:3 ✓) scores 2", scorePlayer(layout, brando, liveOut).total === 2, String(scorePlayer(layout, brando, liveOut).total));
// Single 0-3 correct caller → 1.
const oneHit: PlayerPickMap[string] = { 105: { [G]: { 0: 999003, 1: 999004, 8: GAIMIN, 9: 999005 } } };
check("single-correct (Gaimin 0:3 ✓) scores 1", scorePlayer(layout, oneHit, liveOut).total === 1, String(scorePlayer(layout, oneHit, liveOut).total));
// All-wrong → 0.
const zero: PlayerPickMap[string] = { 105: { [G]: { 0: 999006, 1: 999007, 8: 999008, 9: 999009 } } };
check("all-wrong caller scores 0", scorePlayer(layout, zero, liveOut).total === 0);

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
