/**
 * verify-arcade-sync — offline proof for PHA-4506 (Hotline -> arcade PHATT ID progression).
 * Run: node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs scripts/verify-arcade-sync.ts
 */
import {
  buildArcadeEvents, ndjsonBatches, charmEarnedAt, stampAt, coinItem, summarize, MAX_LINES,
} from "../src/lib/arcade-sync-core.ts";
import { buildLedger, ledgerTotal, localDay, CHARMS, XP } from "../src/lib/progression-core.ts";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean) => { if (c) pass++; else { fail++; console.error("FAIL", name); } };

const SUB = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c", PID = "cmabc123def456ghi789jkl0";
const H = 36e5, D = 24 * H;
const now = Date.parse("2026-11-14T18:00:00Z");
// Cologne-era history (months old) plus two recent days, one of them today.
const activities = [
  { atMs: Date.parse("2026-06-03T15:00:00Z"), kind: "stage" as const },
  { atMs: Date.parse("2026-06-03T16:00:00Z"), kind: "stage" as const },
  { atMs: Date.parse("2026-06-04T15:00:00Z"), kind: "visit" as const },
  { atMs: now - 2 * D, kind: "stage" as const },
  { atMs: now - H, kind: "stage" as const },
];
const unlocks = [
  { key: "first_call" as const, atMs: Date.parse("2026-06-03T15:00:00Z") },
  { key: "perfect_swiss" as const, atMs: Date.parse("2026-06-07T20:00:00Z") },
];
const finished = Date.parse("2026-06-22T21:00:00Z");
const ledger = buildLedger(activities, [{ atMs: finished, source: "major_finished" }, ...unlocks.map((u) => ({ atMs: u.atMs, source: "achievement" as const }))]);
const charms = charmEarnedAt(CHARMS, unlocks);
const input = {
  playerId: PID, arcadeId: SUB, nowMs: now, ledger,
  majors: [{ eventId: 105, score: 41, rank: 3, atMs: finished }],
  unlocks,
  coins: [{ eventId: 105, slug: "cologne-2026", tier: "gold", atMs: finished }],
  charms,
};
const evs = buildArcadeEvents(input);

const results = evs.filter((e) => e.type === "result");
const today = localDay(now);
ok("today's open day is not sent", !evs.some((e) => e.id.endsWith(`-d-${today}`)));
ok("closed days are sent, one per day", results.filter((e) => e.id.includes("-d-")).length === 3);
const todayXp = ledger.filter((r) => r.day === today).reduce((n, r) => n + r.credited, 0);
const arcadeXp = results.reduce((n, e) => n + Number(e.payload.xp_award), 0) + unlocks.length * XP.achievement;
ok("arcade Hotline XP = Hotline XP minus today", arcadeXp === ledgerTotal(ledger) - todayXp);
ok("no day award breaks the arcade cap (500)", results.every((e) => Number(e.payload.xp_award) <= 500));

const major = evs.find((e) => e.id === `hl1-${PID}-m-105`);
ok("Major result: score, rank, 50 XP", !!major && major.payload.score === 41 && major.payload.rank === 3 && major.payload.xp_award === 50);
const noRank = buildArcadeEvents({ ...input, majors: [{ eventId: 105, score: 0, rank: null, atMs: finished }] }).find((e) => e.id.endsWith("-m-105"))!;
ok("unknown finish: rank left out, not 0", !("rank" in noRank.payload));

ok("achievement -> unlock_item achievement.<key>", evs.some((e) => e.type === "unlock_item" && e.payload.item === "achievement.perfect_swiss"));
ok("coin -> item in hotline namespace, arcade-safe", coinItem("cologne-2026", "gold") === "hotline_coin_cologne_2026_gold" && evs.some((e) => e.payload.item === "hotline_coin_cologne_2026_gold"));
ok("charms: C4 at first unlock, defuse kit at Perfect Swiss",
  JSON.stringify(charms) === JSON.stringify([{ key: "c4_plush", atMs: unlocks[0].atMs }, { key: "defuse_kit", atMs: unlocks[1].atMs }]));
ok("charm -> item", evs.some((e) => e.type === "item" && e.payload.item === "hotline_charm_defuse_kit"));

ok("ids match the arcade's shape", evs.every((e) => /^[A-Za-z0-9_-]{8,64}$/.test(e.id)));
ok("ids are unique", new Set(evs.map((e) => e.id)).size === evs.length);
ok("ids never carry the PHATT ID", evs.every((e) => !e.id.includes(SUB) && e.arcade_id === SUB));
ok("deterministic: a rerun builds the same ids", JSON.stringify(buildArcadeEvents(input).map((e) => e.id)) === JSON.stringify(evs.map((e) => e.id)));
ok("a later rerun still builds the same ids", JSON.stringify(buildArcadeEvents({ ...input, nowMs: now + 3 * H }).map((e) => e.id)) === JSON.stringify(evs.map((e) => e.id)));
ok("every event inside the arcade's 7-day window", evs.every((e) => e.at <= now && e.at >= now - 7 * D));
ok("stampAt keeps recent times, clamps old and future", stampAt(now - H, now) === now - H && stampAt(0, now) === now - 6 * D && stampAt(now + H, now) === now);

const many = Array.from({ length: 250 }, (_, i) => ({ ...evs[0], id: `x${i}` }));
const b = ndjsonBatches(many);
ok("batches of at most 100 lines", b.length === 3 && b.every((s) => s.split("\n").length <= MAX_LINES));

const s = summarize([{ accepted: 2, duplicate: 1, rejected: [{ id: "a", reason: "unknown_member" }, { id: "b", reason: "bad_item" }] }]);
ok("unknown_member is pending, not a failure", s.pending === 1 && s.rejected.length === 1 && s.rejected[0].reason === "bad_item");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
