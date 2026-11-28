/**
 * verify-match-schedule — offline proof for PHA-5538 (upcoming matches and
 * start times next to finished ones).
 *
 * The day-one breaking cases from the plan:
 *   - a round whose pairings aren't published yet (TBD sides) still lists;
 *   - a match with no time lands under "TBA", never with an invented time;
 *   - a postponed match whose time changes moves to its new day on re-read;
 *   - a viewer whose zone puts the match across midnight sees it on THEIR day.
 * Plus the spoiler-free wiring: only round-1 pairings are safe, and the CSS
 * masks scores, record labels and later pairings while keeping times.
 *
 * Run: node scripts/verify-match-schedule.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  flattenSwissSchedule,
  groupByLocalDay,
  localDayKey,
  matchState,
  relativeDay,
  shiftDayKey,
  swissRoundNumber,
  type SchedRoundInput,
} from "../src/lib/match-schedule-core.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

const side = (name: string | null, score: number | null = null, winner = false) => ({ name, pickid: null, score, winner });
const T = (iso: string) => Date.parse(iso);

// Shape of Stage II on 2026-11-28 (the live cache at 16:49Z): round 1 and 2
// played, round 3 published for 11-29, plus a TBD round-4 cell and one
// published match with no time.
const rounds: SchedRoundInput[] = [
  {
    label: "0:0",
    kind: "contention",
    matches: [
      { matchId: 2400583, team1: side("The MongolZ", 13, true), team2: side("Lynn Vision", 9), bestOf: 1, played: true, startTimeMs: T("2026-11-28T04:00:00Z") },
      { matchId: 2400582, team1: side("FUT", 13, true), team2: side("FlyQuest", 10), bestOf: 1, played: true, startTimeMs: T("2026-11-28T04:00:00Z") },
    ],
  },
  {
    label: "1:0",
    kind: "contention",
    matches: [{ matchId: 2400590, team1: side("G2", 13, true), team2: side("Ninjas in Pyjamas", 10), bestOf: 1, played: true, startTimeMs: T("2026-11-28T09:25:00Z") }],
  },
  {
    label: "2:0",
    kind: "contention",
    matches: [{ matchId: 2400602, team1: side("G2"), team2: side("1win"), bestOf: 3, played: false, startTimeMs: T("2026-11-29T08:00:00Z") }],
  },
  {
    label: "1:1",
    kind: "contention",
    matches: [
      { matchId: 2400598, team1: side("100 Thieves"), team2: side("Nemiga"), bestOf: 3, played: false, startTimeMs: T("2026-11-29T06:00:00Z") },
      { matchId: null, team1: side("Astralis"), team2: side("MIBR"), bestOf: 3, played: false, startTimeMs: null },
    ],
  },
  {
    label: "2:1",
    kind: "contention",
    matches: [{ matchId: 2400610, team1: side(null), team2: side(null), bestOf: 3, played: false, startTimeMs: T("2026-11-30T06:00:00Z") }],
  },
  { label: "3:0", kind: "advancing", matches: [] },
];

console.log("round numbers");
check("0:0 is round 1", swissRoundNumber("0:0") === 1);
check("2:1 is round 4", swissRoundNumber("2:1") === 4);
check("unparseable label is null", swissRoundNumber("Final") === null);

console.log("flatten");
const flat = flattenSwissSchedule(rounds);
check("every contention cell listed, terminal columns skipped", flat.length === 7, flat.length);
check("kick-off order, round-1 first", flat[0].round === 1 && flat[2].record === "1:0");
check("same-instant ties keep source order", flat[0].team1.name === "The MongolZ" && flat[1].team1.name === "FUT");
check("1:1 at 06:00 sorts before 2:0 at 08:00", flat[3].record === "1:1" && flat[4].record === "2:0");
check("no-time match sorts last", flat[flat.length - 1].startTimeMs === null);
check("unpublished pairing listed with null sides", flat.some((m) => m.team1.name === null && m.team2.name === null && m.round === 4));
check("only round 1 is spoiler-safe", flat.every((m) => m.spoilsRecords === (m.round !== 1)));
check("keys unique", new Set(flat.map((m) => m.key)).size === flat.length);
check("NaN start time treated as no time",
  flattenSwissSchedule([{ label: "0:0", kind: "contention", matches: [{ matchId: 1, team1: side("A"), team2: side("B"), bestOf: 1, played: false, startTimeMs: NaN }] }])[0].startTimeMs === null);

console.log("local day grouping");
const nowSG = T("2026-11-28T16:50:00Z");
const utc = groupByLocalDay(flat, nowSG, "UTC");
check("UTC viewer: 11-28 today, 11-29 tomorrow, 11-30 after, TBA last",
  utc.map((g) => `${g.key}:${g.rel}`).join(",") === "2026-11-28:today,2026-11-29:tomorrow,2026-11-30:null,tba:null",
  utc.map((g) => `${g.key}:${g.rel}`));
check("no-time match is in the TBA bucket", utc[utc.length - 1].matches.length === 1 && utc[utc.length - 1].matches[0].startTimeMs === null);

// Midnight crossing: Los Angeles at 08:50 PST on 11-28. The 11-29 06:00Z match
// is 22:00 on 11-28 there, so it's TODAY for that viewer, not tomorrow.
const la = groupByLocalDay(flat, nowSG, "America/Los_Angeles");
const laToday = la.find((g) => g.rel === "today");
check("LA viewer: 06:00Z next day is tonight", !!laToday?.matches.some((m) => m.key === "m2400598"), la.map((g) => g.key));
check("LA viewer: 04:00Z on 11-28 is yesterday (11-27 local)", la[0].key === "2026-11-27" && la[0].rel === "yesterday" && la[0].past);
// Sydney (UTC+11): 11-28 16:50Z is already 11-29 03:50 there.
const syd = groupByLocalDay(flat, nowSG, "Australia/Sydney");
check("Sydney viewer: 11-29 08:00Z is today", syd.find((g) => g.rel === "today")?.matches.some((m) => m.key === "m2400602") === true);

// Postponed: the same match re-read with a later time moves day.
const postponed = flattenSwissSchedule(
  rounds.map((r) => ({ ...r, matches: r.matches.map((m) => (m.matchId === 2400602 ? { ...m, startTimeMs: T("2026-11-30T10:00:00Z") } : m)) })),
);
const pg = groupByLocalDay(postponed, nowSG, "UTC");
check("postponed match moves to its new day",
  pg.find((g) => g.key === "2026-11-30")!.matches.some((m) => m.key === "m2400602") &&
    !pg.find((g) => g.key === "2026-11-29")!.matches.some((m) => m.key === "m2400602"));

console.log("day keys");
check("day key in zone", localDayKey(T("2026-11-29T06:00:00Z"), "America/Los_Angeles") === "2026-11-28");
check("shift across month end", shiftDayKey("2026-11-30", 1) === "2026-12-01");
check("shift across year end", shiftDayKey("2026-12-31", 1) === "2027-01-01");
check("relative labels", relativeDay("2026-11-29", "2026-11-28") === "tomorrow" && relativeDay("2026-11-27", "2026-11-28") === "yesterday" && relativeDay("2026-12-01", "2026-11-28") === null);

console.log("match state");
check("played → final", matchState({ played: true, startTimeMs: nowSG + 1e6 }, nowSG) === "final");
check("started, no result → live", matchState({ played: false, startTimeMs: nowSG - 1 }, nowSG) === "live");
check("future → upcoming", matchState({ played: false, startTimeMs: nowSG + 1 }, nowSG) === "upcoming");
check("no time → tba", matchState({ played: false, startTimeMs: null }, nowSG) === "tba");

console.log("wiring");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "src/app/(app)/picks/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/styles/sg-picks.css"), "utf8");
const list = readFileSync(join(root, "src/components/heat/MatchSchedule.tsx"), "utf8");
const sfStart = page.indexOf("<SpoilerFree");
const sfEnd = page.indexOf("</SpoilerFree>");
const inSf = page.slice(sfStart, sfEnd);
check("locked stage renders the match list inside <SpoilerFree>", sfStart > 0 && inSf.includes("<SwissMatchList"));
check("open stage renders the match list too", page.slice(0, sfStart).includes("<SwissMatchList"));
check("match list is not blurred wholesale (times must stay readable)", !/<SwissMatchList[^>]*sf-hide/.test(inSf));
for (const sel of [".sch-rec", ".sch-res", ".sch-row.sf-pair .sch-side", ".sch-row.sf-pair .sch-mid"]) {
  check(`spoiler-free masks ${sel}`, new RegExp(`\\.sf-results\\.sf-on ${sel.replace(/\./g, "\\.")}[^{]*\\{[^}]*opacity: 0`).test(css) ||
    css.split("}").some((rule) => rule.includes(`.sf-results.sf-on ${sel}`) && rule.includes("opacity: 0")));
}
check("spoiler-free never masks the clock", !css.split("}").some((r) => r.includes(".sf-on") && r.includes(".sch-clock") && r.includes("opacity: 0")));
check("round-2+ rows carry sf-pair from spoilsRecords", list.includes('m.spoilsRecords ? "sf-pair"'));

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall match-schedule checks passed");
