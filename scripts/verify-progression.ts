/**
 * verify-progression — offline proof for PHA-4477 (Hotline joins PHATT ID).
 *
 * Pins the rules Brandon approved on card c8646c5a so they can't drift:
 *   • the PHA-4239 curve: level 50 at 4,312 XP, (L−1)² + 39(L−1), capped at 50;
 *   • XP: 20 showing up, 12 then ×0.6 per stage entered in a day, 80/day and
 *     300/week caps, 50 per Major finished and 25 per achievement outside caps;
 *   • a stage counts only once it has LOCKED with a full set of picks;
 *   • each of the 12 achievement rules, at the earliest instant it was earned;
 *   • felts unlock at the title levels; a stale loadout falls back to default.
 *
 * Pure-only (no prisma). Run: node scripts/verify-progression.ts
 */

import {
  xpForLevel,
  levelForXp,
  gamePlayedXp,
  buildLedger,
  ledgerTotal,
  evaluateAchievements,
  ledgerFor,
  parseLoadout,
  effectiveLoadout,
  FELTS,
  ACHIEVEMENTS,
  coinItemKey,
  type StageFact,
  type PlayerFacts,
  type AchievementKey,
} from "../src/lib/progression-core.ts";
import { achievementEntries, ACHIEVEMENTS_LAUNCH_MS } from "../src/lib/notifications-core.ts";

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

const H = 3600_000;
const D = 24 * H;
const T0 = Date.parse("2026-06-02T16:00:00Z"); // a Tuesday, noon New York

console.log("curve");
check("level 1 at 0 XP", levelForXp(0) === 1);
check("level 2 costs 40", xpForLevel(2) === 40 && levelForXp(39) === 1 && levelForXp(40) === 2);
check("level 10 at 432", xpForLevel(10) === 432 && levelForXp(432) === 10 && levelForXp(431) === 9);
check("level 50 at 4,312", xpForLevel(50) === 4312 && levelForXp(4312) === 50);
check("capped at 50", levelForXp(1e9) === 50);

console.log("sources + caps");
check("game-played chain 12,7,4,3,2", [0, 1, 2, 3, 4].map(gamePlayedXp).join() === "12,7,4,3,2");
{
  const rows = buildLedger([{ atMs: T0, kind: "stage" }], []);
  check("one stage day = 20 + 12", ledgerTotal(rows) === 32);
}
{
  const rows = buildLedger(Array.from({ length: 8 }, (_, i) => ({ atMs: T0 + i * 60_000, kind: "stage" as const })), []);
  const t = ledgerTotal(rows);
  check("8 stages in a day stay under the chain + cap", t === 20 + 12 + 7 + 4 + 3 + 2 + 1 + 1 + 0);
  check("…and never pass 80", t <= 80);
}
{
  // Heavy day: 20 showing up + 12 + 7 + … would exceed 80 only past the chain; force it with many visits + stages
  const acts = Array.from({ length: 30 }, (_, i) => ({ atMs: T0 + i * 1000, kind: "stage" as const }));
  check("daily cap holds", ledgerTotal(buildLedger(acts, [])) <= 80);
}
{
  // Mon–Sun, a stage-heavy day each (50 XP raw a day = 350): the weekly cap bites at 300
  const acts = [];
  for (let d = 0; d < 7; d++) for (let i = 0; i < 12; i++) acts.push({ atMs: T0 - D + d * D + i * 1000, kind: "stage" as const });
  const rows = buildLedger(acts, []);
  check("weekly cap holds at 300", ledgerTotal(rows) === 300);
  check("weekly cap is marked", rows.some((r) => r.cappedBy === "week"));
}
{
  const rows = buildLedger([], [
    { atMs: T0, source: "major_finished" },
    { atMs: T0, source: "achievement" },
    { atMs: T0, source: "achievement" },
  ]);
  check("Major finished 50 + achievements 25 each, uncapped", ledgerTotal(rows) === 100);
}
{
  const rows = buildLedger([{ atMs: T0, kind: "visit" }, { atMs: T0 + H, kind: "visit" }], []);
  check("visits only show up once a day (20)", ledgerTotal(rows) === 20);
}

console.log("achievements");
const stage = (o: Partial<StageFact> = {}): StageFact => ({
  stageId: 105,
  isPlayoffs: false,
  full: true,
  lockAtMs: T0,
  resolvedAtMs: T0 + 3 * D,
  points: 4,
  topPoints: 6,
  rankAfter: 3,
  rankBefore: null,
  perfectSwiss: false,
  allQuarterFinals: null,
  quarterFinalsAtMs: null,
  champion: null,
  championAtMs: null,
  seal: null,
  ...o,
});
const facts = (stages: StageFact[], extra: Partial<PlayerFacts> = {}): PlayerFacts => ({
  majors: [{ eventId: 26, slug: "iem-cologne-2026", stages, finishedAtMs: T0 + 20 * D, finished: true }],
  syncedAtMs: null,
  reactionsSentAtMs: [],
  nowMs: T0 + 60 * D,
  ...extra,
});
const keys = (f: PlayerFacts) => new Set(evaluateAchievements(f).map((u) => u.key));
const has = (f: PlayerFacts, k: AchievementKey) => keys(f).has(k);

check("first_call on a full, locked stage", has(facts([stage()]), "first_call"));
check("no first_call when the stage isn't full", !has(facts([stage({ full: false })]), "first_call"));
check(
  "no first_call before the lock",
  !has({ ...facts([stage({ lockAtMs: T0 + 90 * D, resolvedAtMs: null })]), nowMs: T0 }, "first_call"),
);
check("full_card when every stage is full", has(facts([stage(), stage({ stageId: 106 })]), "full_card"));
check("no full_card with a gap", !has(facts([stage(), stage({ stageId: 106, full: false })]), "full_card"));
check("synced from the first Valve write", has(facts([], { syncedAtMs: T0 }), "synced"));
check("stage_topper on the best score", has(facts([stage({ points: 6, topPoints: 6 })]), "stage_topper"));
check("stage_topper counts ties", has(facts([stage({ points: 6, topPoints: 6 })]), "stage_topper"));
check("no stage_topper at 0-0", !has(facts([stage({ points: 0, topPoints: 0 })]), "stage_topper"));
check("no stage_topper while unresolved", !has(facts([stage({ points: 6, topPoints: null, resolvedAtMs: null })]), "stage_topper"));
check(
  "clean_sweep on all four quarter-finals",
  has(facts([stage({ isPlayoffs: true, allQuarterFinals: true, quarterFinalsAtMs: T0 + 5 * D })]), "clean_sweep"),
);
check("called_it on the champion", has(facts([stage({ isPlayoffs: true, champion: true, championAtMs: T0 + 7 * D })]), "called_it"));
check("no called_it on a wrong final", !has(facts([stage({ isPlayoffs: true, champion: false, championAtMs: T0 })]), "called_it"));
check("climber on +2 places", has(facts([stage({ rankBefore: 4, rankAfter: 2 })]), "climber"));
check("no climber on +1", !has(facts([stage({ rankBefore: 3, rankAfter: 2 })]), "climber"));
check(
  "bleachers on the 10th reaction",
  has(facts([], { reactionsSentAtMs: Array.from({ length: 10 }, (_, i) => T0 + i) }), "bleachers") &&
    !has(facts([], { reactionsSentAtMs: Array.from({ length: 9 }, (_, i) => T0 + i) }), "bleachers"),
);
check("show_your_hand on a public seal", has(facts([stage({ seal: { visibility: "public", lockedAtMs: T0 - H } })]), "show_your_hand"));
check(
  "poker_face: hidden seal + top the stage",
  has(facts([stage({ points: 6, topPoints: 6, seal: { visibility: "hidden", lockedAtMs: T0 - H } })]), "poker_face"),
);
check(
  "no poker_face without topping it",
  !has(facts([stage({ points: 2, topPoints: 6, seal: { visibility: "hidden", lockedAtMs: T0 - H } })]), "poker_face"),
);
check("perfect_swiss on exact 3-0 and 0-3", has(facts([stage({ perfectSwiss: true })]), "perfect_swiss"));
{
  const two: PlayerFacts = {
    ...facts([stage()]),
    majors: [
      { eventId: 26, slug: "iem-cologne-2026", stages: [stage()], finishedAtMs: T0 + 20 * D, finished: true },
      { eventId: 27, slug: "pgl-singapore-2026", stages: [stage({ lockAtMs: T0 + 40 * D })], finishedAtMs: null, finished: false },
    ],
  };
  const v = evaluateAchievements(two).find((u) => u.key === "veteran");
  check("veteran on the second Major", !!v && v.eventId === 27 && v.atMs === T0 + 40 * D);
  check("no veteran on one Major", !has(facts([stage()]), "veteran"));
}
{
  const u = evaluateAchievements(facts([stage({ lockAtMs: T0 + D }), stage({ stageId: 106, lockAtMs: T0 })]));
  const fc = u.find((x) => x.key === "first_call");
  check("first_call dated at the earliest stage", !!fc && fc.atMs === T0);
  check("unlocks come back in registry order", u.map((x) => ACHIEVEMENTS.findIndex((a) => a.key === x.key)).every((v, i, a) => i === 0 || a[i - 1] < v));
}

console.log("ledger from facts");
{
  const f = facts([stage(), stage({ stageId: 106, lockAtMs: T0 + 2 * D })], { syncedAtMs: T0 });
  const u = evaluateAchievements(f);
  const xp = ledgerTotal(ledgerFor(f, u));
  // 2 stage days (32 each) + 50 finished + 25 × (first_call, full_card, synced)
  check("two stage days + finish + 3 achievements = 189", xp === 64 + 50 + 75);
}

console.log("unlockables");
check("felts unlock at the title levels", FELTS.map((f) => f.level).join() === "1,10,20,30,40,50");
check("bad loadout JSON is empty", parseLoadout("{oops").felt === null);
check("unknown keys are dropped", parseLoadout(JSON.stringify({ felt: "plaid", banner: "nope" })).banner === null);
check(
  "a felt above your level falls back",
  effectiveLoadout({ felt: "forest", banner: null }, 12, new Set()).felt === null &&
    effectiveLoadout({ felt: "oxblood", banner: null }, 12, new Set()).felt === "oxblood",
);
check(
  "a banner you don't hold falls back",
  effectiveLoadout({ felt: null, banner: "called_it" }, 1, new Set()).banner === null &&
    effectiveLoadout({ felt: null, banner: "called_it" }, 1, new Set<AchievementKey>(["called_it"])).banner === "called_it",
);
check("coin item key", coinItemKey("iem-cologne-2026", "gold") === "hotline/coin.iem-cologne-2026.gold");
check("12 achievements, 12 distinct banners", ACHIEVEMENTS.length === 12 && new Set(ACHIEVEMENTS.map((a) => a.banner)).size === 12);

console.log("notifications");
{
  const now = ACHIEVEMENTS_LAUNCH_MS + 2 * H;
  const e = achievementEntries(
    [
      { key: "first_call", name: "First Call", trinket: "Rotary handset", atMs: ACHIEVEMENTS_LAUNCH_MS - 120 * D },
      { key: "called_it", name: "Called It", trinket: "Crown", atMs: ACHIEVEMENTS_LAUNCH_MS - 100 * D },
      { key: "veteran", name: "Veteran", trinket: "Twin stars", atMs: ACHIEVEMENTS_LAUNCH_MS + H },
    ],
    "/players/x",
    now,
  );
  check("pre-launch unlocks roll up into one entry", e.filter((x) => x.id === "ach:launch").length === 1 && e[0].title.startsWith("2 "));
  check("post-launch unlock gets its own entry", e.some((x) => x.id === "ach:veteran"));
  check("entries land on the wall", e.every((x) => x.href === "/players/x#achievements"));
  check("roll-up ages out after 30 days", achievementEntries([{ key: "a", name: "A", trinket: "T", atMs: 0 }], "/p", ACHIEVEMENTS_LAUNCH_MS + 31 * D).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
