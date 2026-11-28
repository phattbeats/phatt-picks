/**
 * verify-swiss-slot-times — offline proof for PHA-5538: the Swiss bracket's
 * empty slots show their start times, and a stage that hasn't started counts
 * down to its first match.
 *
 * Day-one breaking cases:
 *   - HLTV's numbering (which "#n" lands in which record box) is checked
 *     against what HLTV actually paired on Singapore Stage I and II;
 *   - a partly paired box fills only its remaining slots;
 *   - a slot HLTV hasn't timed stays "VS" (no invented time);
 *   - a postponed game moves on the next read;
 *   - playoff games on the hub list never land in a Swiss slot;
 *   - a viewer whose zone puts a game across midnight sees it on THEIR day.
 * Plus the page wiring: no separate Matches list, both brackets get the list,
 * future stages count down.
 *
 * Run: node --experimental-strip-types scripts/verify-swiss-slot-times.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHltvMatchList } from "../src/lib/playoff-schedule-core.ts";
import {
  SWISS_BOX_ORDINALS,
  boxRound,
  firstListedStartMs,
  listedSwissGames,
  parseSwissRoundLabel,
  slotTimesForBox,
  type ListedSwissGame,
} from "../src/lib/swiss-slot-times-core.ts";
import { localDayKey, relativeDay } from "../src/lib/match-schedule-core.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}
const T = (iso: string) => Date.parse(iso);
const iso = (ms: number[]) => ms.map((m) => new Date(m).toISOString().slice(5, 16));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Fixture {
  stage1FirstIds: Record<string, number>;
  stage2FirstIds: Record<string, number>;
  boxes: Record<string, Record<string, number[]>>;
  stage2List: { matchId: number; startMs: number | null; label: string }[];
}
const fx = JSON.parse(readFileSync(join(root, "src/fixtures/hltv-sg-swiss-numbering.json"), "utf8")) as Fixture;

console.log("HLTV numbering vs what HLTV paired (Singapore Stage I + II)");
for (const [stage, firstIds] of [
  ["stage1", fx.stage1FirstIds],
  ["stage2", fx.stage2FirstIds],
] as const) {
  for (const [box, ids] of Object.entries(fx.boxes[stage])) {
    const r = boxRound(box)!;
    const ordinals = ids.map((id) => id - firstIds[String(r)] + 1).sort((a, b) => a - b);
    check(`${stage} ${box} (R${r}) = #${ordinals.join(" #")}`, same(ordinals, SWISS_BOX_ORDINALS[box]), SWISS_BOX_ORDINALS[box]);
  }
}
// The id→ordinal step above assumes HLTV allocates a round's ids in "#n"
// order. Check it on the unpaired games, which still carry their labels.
const labelled = fx.stage2List.filter((m) => parseSwissRoundLabel(m.label));
check("Stage II list has unpaired R4 + R5 games", labelled.length === 9, labelled.length);
check(
  "a round's match ids run in #n order",
  labelled.every((m) => {
    const l = parseSwissRoundLabel(m.label)!;
    return m.matchId - fx.stage2FirstIds[String(l.round)] + 1 === l.ordinal;
  }),
);
check("every box of rounds 1-5 has a mapping", ["0:0", "1:0", "0:1", "1:1", "2:0", "0:2", "2:1", "1:2", "2:2"].every((b) => SWISS_BOX_ORDINALS[b]));
check(
  "each round's mapping covers its games exactly once",
  [1, 2, 3, 4, 5].every((r) => {
    const all = Object.entries(SWISS_BOX_ORDINALS)
      .filter(([b]) => boxRound(b) === r)
      .flatMap(([, o]) => o)
      .sort((a, b) => a - b);
    const n = { 1: 8, 2: 8, 3: 8, 4: 6, 5: 3 }[r]!;
    return same(all, Array.from({ length: n }, (_, i) => i + 1));
  }),
);

console.log("\nStage II on 2026-11-28: round 3 paired, rounds 4-5 unpaired");
const list = fx.stage2List.filter((m): m is { matchId: number; startMs: number; label: string } => m.startMs != null);
const games = listedSwissGames(list);
check("paired R3 games drop out, R4 + R5 stay", same(games.map((g) => `${g.round}#${g.ordinal}`), ["4#1", "4#2", "4#3", "4#4", "4#5", "4#6", "5#1", "5#2", "5#3"]));
check("2:1 slots: 11-30 06:00 / 08:30 / 11:00", same(iso(slotTimesForBox("2:1", games, 0, 3)), ["11-30T06:00", "11-30T08:30", "11-30T11:00"]), iso(slotTimesForBox("2:1", games, 0, 3)));
check("1:2 slots: 11-30 06:00 / 08:30 / 11:00", same(iso(slotTimesForBox("1:2", games, 0, 3)), ["11-30T06:00", "11-30T08:30", "11-30T11:00"]));
check("2:2 slots: 12-01 06:00 / 08:30 / 11:00", same(iso(slotTimesForBox("2:2", games, 0, 3)), ["12-01T06:00", "12-01T08:30", "12-01T11:00"]));
check("paired boxes get nothing from the list (2:0, 1:1)", slotTimesForBox("2:0", games, 2, 2).length === 0 && slotTimesForBox("1:1", games, 4, 4).length === 0);
check("team boxes (3:0, 0:3) never get a time", slotTimesForBox("3:0", games, 0, 2).length === 0 && slotTimesForBox("0:3", games, 0, 2).length === 0);

console.log("\nDay-one cases");
const drop = (gs: ListedSwissGame[], ...keys: string[]) => gs.filter((g) => !keys.includes(`${g.round}#${g.ordinal}`));
const partial = drop(games, "4#1", "4#3"); // HLTV paired two 2:1 games
check("partly paired 2:1 box: only its last slot is timed", same(iso(slotTimesForBox("2:1", partial, 2, 3)), ["11-30T11:00"]));
const untimed = drop(games, "4#5"); // HLTV dropped #5's time
check("an untimed game leaves its slot as VS (no invented time)", same(iso(slotTimesForBox("2:1", untimed, 0, 3)), ["11-30T06:00", "11-30T08:30"]));
const moved = games.map((g) => (g.round === 4 && g.ordinal === 1 ? { ...g, startMs: T("2026-11-30T07:15:00Z") } : g));
check("a postponed game shows its new time", iso(slotTimesForBox("2:1", moved, 0, 3))[0] === "11-30T07:15");
const dup = listedSwissGames([...list, list.find((m) => /Round 4 #1/.test(m.label))!]);
check("a duplicated entry never doubles a slot", dup.length === games.length);
const hub = [
  { matchId: 1, startMs: T("2026-12-02T04:00:00Z"), label: "PGL Major Singapore 2026 - Swiss Round 1 #1" },
  { matchId: 2, startMs: T("2026-12-02T06:30:00Z"), label: "PGL Major Singapore 2026 - Swiss Round 1 #3" },
  { matchId: 3, startMs: T("2026-12-10T09:00:00Z"), label: "PGL Major Singapore 2026 - Quarter-final #1" },
  { matchId: 4, startMs: T("2026-12-13T10:00:00Z"), label: "PGL Major Singapore 2026 - Grand Final" },
];
const hubGames = listedSwissGames(hub);
check("hub list: playoff games never become Swiss slots", hubGames.length === 2);
check("Stage III countdown target = first listed R1 game (12-02 04:00Z)", firstListedStartMs(hubGames) === T("2026-12-02T04:00:00Z"));
check("no countdown target once round 1 is paired", firstListedStartMs(games) === null);
check("no countdown target from an empty list", firstListedStartMs([]) === null);
check("parseHltvMatchList reads nothing from a challenge page", parseHltvMatchList("<html>Just a moment...</html>").length === 0);

console.log("\nViewer's day");
const r4 = T("2026-11-30T06:00:00Z");
check("Los Angeles: 06:00Z on 11-30 is the evening of 11-29", localDayKey(r4, "America/Los_Angeles") === "2026-11-29");
check(
  "...so at 11-29 18:00 LA it reads Today",
  relativeDay(localDayKey(r4, "America/Los_Angeles"), localDayKey(T("2026-11-30T02:00:00Z"), "America/Los_Angeles")) === "today",
);
check("Singapore: same game is Tomorrow at 11-29 20:00 SGT", relativeDay(localDayKey(r4, "Asia/Singapore"), localDayKey(T("2026-11-29T12:00:00Z"), "Asia/Singapore")) === "tomorrow");

console.log("\nWiring");
const page = readFileSync(join(root, "src/app/(app)/picks/page.tsx"), "utf8");
const board = readFileSync(join(root, "src/components/heat/LiveSwissBracketBoard.tsx"), "utf8");
check("no separate Matches list on the page", !page.includes("SwissMatchList"));
check("Matches list components are gone", !existsSync(join(root, "src/components/heat/MatchSchedule.tsx")) && !existsSync(join(root, "src/components/heat/SwissMatchList.tsx")));
check("both bracket renders get the listed games", (page.match(/listed=\{listedGames\}/g) ?? []).length === 2);
check("the board times blank slots from the list", board.includes("slotTimesForBox(") && board.includes("<SlotTime ms={startMs}"));
check("paired unplayed matches show their own time", board.includes("<SlotTime ms={match.startTimeMs} paired"));
check("future stage counts down to its start", /upcomingStart && [^\n]*\?\s*\(\s*<LockCountdown variant="box" lockAt=\{upcomingStart\}/.test(page));

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall swiss-slot-times checks passed");
