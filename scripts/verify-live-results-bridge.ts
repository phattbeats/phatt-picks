/**
 * verify-live-results-bridge - offline proof for the live-results bridge that
 * the PHA-1109 scheduler drives (refreshLiveResultsTick → bridgeSwissOutcomes).
 *
 * PHA-1109: a 0-3 elimination (B8) showed no green checkmark and awarded no
 * points because the HLTV standings crawl + StageOutcome bridge were deferred via
 * after() (which doesn't fire reliably in the standalone server), so the answer
 * key froze. The in-process scheduler now drives the crawl+bridge on a fixed
 * tick. The crawl/scheduler glue is runtime I/O, but the BRIDGE'S derivation —
 * turning live W-L records into resolved StageOutcome bucket slots — is pure and
 * is exactly what makes a clinched team go green AND score. This loads a REAL
 * captured snapshot of the live Stage III table (src/fixtures/
 * hltv-stage3-standings.sample.md, IEM Cologne Major 2026, 2026-06-14) and proves
 * the parse → match → deriveClinchedSlots chain writes the terminal clinches into
 * the correct buckets: the 0-3 elimination lands in a 0:3 slot, the 3-0 runs land
 * in 3:0 slots, and a team eliminated WITH a win (e.g. 1-3) is NOT placed in the
 * winless 0:3 bucket. Mid-record teams stay unresolved (pending).
 *
 * Run: node scripts/verify-live-results-bridge.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHltvSwissStandings, matchStandingsToLayout } from "../src/lib/swiss-results-core.ts";
import { deriveClinchedSlots, pickBucketForRecord } from "../src/lib/swiss-clinch-core.ts";
import { bucketSwissSlots } from "../src/lib/swiss-bucket-core.ts";
import { bracketMatchRecords, type SwissRound } from "../src/lib/swiss-bracket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }).result;
const stage3: Section = layout.sections.find((s) => s.sectionid === 107)!;
const teams = layout.teams.filter((t) => t.pickid !== 0).map((t) => ({ pickid: t.pickid, name: t.name }));
const sampleMd = read("src/fixtures/hltv-stage3-standings.sample.md");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.error("  FAIL  " + name + (detail ? `  (${detail})` : ""));
  }
}

// Parse + match the live Stage III table.
const raw = parseHltvSwissStandings(sampleMd);
const matched = matchStandingsToLayout(raw, teams);
const byName = (n: string) => matched.find((r) => new RegExp(`^${n}$`, "i").test(r.name));
const pid = (n: string) => byName(n)?.pickid;

console.log("\nlive-results-bridge - parse the captured Stage III table (PHA-1109)");
check("parsed all 16 Swiss seeds", raw.length === 16, `got ${raw.length}`);
check("B8 row parsed as a terminal 0-3", byName("B8")?.wins === 0 && byName("B8")?.losses === 3, JSON.stringify(byName("B8")));
check("B8 mapped to a layout pickid", typeof pid("B8") === "number", String(pid("B8")));

console.log("\nlive-results-bridge - pickBucketForRecord maps each terminal record to its pick bucket");
check("0-3 → 0:3 bucket", pickBucketForRecord(0, 3) === "0-3");
check("3-0 → 3:0 bucket", pickBucketForRecord(3, 0) === "3-0");
check("3-1 → advance bucket", pickBucketForRecord(3, 1) === "advance");
check("1-3 (eliminated WITH a win) → no pick bucket", pickBucketForRecord(1, 3) === null);
check("2-1 (still alive) → unresolved", pickBucketForRecord(2, 1) === null);

// Bridge derivation from an EMPTY answer key (the freeze state: nothing written).
const standings = matched
  .filter((r) => r.pickid != null)
  .map((r) => ({ pickid: r.pickid as number, wins: r.wins, losses: r.losses }));
const fresh = deriveClinchedSlots(stage3, standings, [], bucketSwissSlots);
const slotOf = (p: number | undefined) => fresh.find((f) => f.winnerPickId === p)?.slotIndex;

// Bucket slot layout for a 10-pick Swiss group: 3:0 = [0,1], advance = [2..7], 0:3 = [8,9].
const buckets = bucketSwissSlots(stage3.groups[0].picks.length);
const slots = (label: string) => buckets.find((b) => b.label.includes(label))!.slotIndexes;

console.log("\nlive-results-bridge - deriveClinchedSlots writes terminal clinches into the right buckets");
check("B8 (0-3) IS written — the PHA-1109 fix", slotOf(pid("B8")) !== undefined, `slot=${slotOf(pid("B8"))}`);
check("B8 lands in a 0:3 ELIMINATED slot", slots("0:3").includes(slotOf(pid("B8"))!), `slot=${slotOf(pid("B8"))} not in ${slots("0:3")}`);
check("FURIA (3-0) lands in a 3:0 ADVANCED slot", slots("3:0").includes(slotOf(pid("FURIA"))!), `slot=${slotOf(pid("FURIA"))}`);
check("Spirit (3-0) lands in a 3:0 ADVANCED slot", slots("3:0").includes(slotOf(pid("Spirit"))!), `slot=${slotOf(pid("Spirit"))}`);
check(
  "a 1-3 elimination is NOT written to the winless 0:3 bucket",
  matched.filter((r) => r.wins >= 1 && r.losses >= 3).every((r) => slotOf(r.pickid!) === undefined),
);
check(
  "mid-record teams (e.g. Vitality 2-1) stay unresolved/pending",
  slotOf(pid("Vitality")) === undefined,
  `slot=${slotOf(pid("Vitality"))}`,
);

// Idempotent: once B8 is in the answer key, re-running writes nothing new for it
// (deriveClinchedSlots never rewrites a filled slot / re-places a placed team).
const existing = fresh.map((f) => ({ groupId: f.groupId, slotIndex: f.slotIndex, winnerPickId: f.winnerPickId }));
const again = deriveClinchedSlots(stage3, standings, existing, bucketSwissSlots);
console.log("\nlive-results-bridge - re-running against the written answer key is idempotent");
check("no duplicate writes for already-clinched teams", again.length === 0, `re-wrote ${again.length}`);

// ── PHA-1109 follow-up: resolve from the BRACKET's match cells when the table is
// stale/absent. The live freeze persisted even after the scheduler shipped: the
// in-container crawl's cached W-L *table* lagged behind B8's 0:3 clinch (it still
// read 0-2 from before the floor wedged), and the bridge's table-OR-bracket
// branch trusted that stale table and never consulted the bracket. The bracket's
// per-match results — server-rendered, present in the SAME cache — already showed
// B8 losing its third series. bracketMatchRecords tallies that, and the bridge now
// MERGES every source keeping the most-played (most-current) record per team.
const B8 = pid("B8")!;
const FUR = pid("FURIA")!;
const PARI = pid("PARIVISION") ?? pid("Parivision")!;
// A minimal mapped bracket: B8 lost three series (0-3), FURIA won three (3-0),
// PARIVISION lost three (0-3). Only the loser/winner flags + pickids matter.
const side = (pickid: number, winner: boolean) => ({ name: "", hltvId: null, score: winner ? 2 : 0, winner, pickid });
const series = (id: number, opp: number, idWon: boolean, matchId: number) => ({
  matchId,
  team1: side(id, idWon),
  team2: side(opp, !idWon),
  bestOf: 3,
  played: true,
  startTimeMs: null,
});
const bracketRounds: SwissRound[] = [
  {
    label: "0:0",
    kind: "contention",
    teams: [],
    matches: [
      series(B8, 999, false, 1), // B8 loss 1
      series(B8, 998, false, 2), // B8 loss 2
      series(B8, 997, false, 3), // B8 loss 3 → 0-3
      series(FUR, 996, true, 4),
      series(FUR, 995, true, 5),
      series(FUR, 994, true, 6), // FURIA 3-0
      series(PARI, 993, false, 7),
      series(PARI, 992, false, 8),
      series(PARI, 991, false, 9), // PARIVISION 0-3
    ],
  },
];
const matchRecs = bracketMatchRecords(bracketRounds);
const recOf = (p: number) => matchRecs.find((r) => r.pickid === p);

console.log("\nlive-results-bridge - bracketMatchRecords tally the Swiss record from match cells");
check("B8 tallies to 0-3 from three lost series", recOf(B8)?.wins === 0 && recOf(B8)?.losses === 3, JSON.stringify(recOf(B8)));
check("FURIA tallies to 3-0 from three won series", recOf(FUR)?.wins === 3 && recOf(FUR)?.losses === 0, JSON.stringify(recOf(FUR)));

// The merge the bridge runs: a STALE table (B8 0-2) + the fresh bracket records.
// Stale-table-alone would leave B8 unresolved; the merge keeps the most-played
// record (the bracket's 0-3) and B8 clinches.
const staleTable = [{ pickid: B8, wins: 0, losses: 2 }]; // pre-clinch cached row
const byPick = new Map<number, { pickid: number; wins: number; losses: number }>();
const consider = (r: { pickid: number; wins: number; losses: number }) => {
  const prev = byPick.get(r.pickid);
  if (!prev || r.wins + r.losses > prev.wins + prev.losses) byPick.set(r.pickid, r);
};
for (const r of staleTable) consider(r);
for (const r of matchRecs) consider(r);
const merged = [...byPick.values()];

console.log("\nlive-results-bridge - merging stale table + bracket keeps the most-current record");
check("stale table alone would NOT clinch B8 (0-2)", pickBucketForRecord(0, 2) === null);
check("merged B8 record is the bracket's terminal 0-3", byPick.get(B8)?.losses === 3);
const mergedFresh = deriveClinchedSlots(stage3, merged, [], bucketSwissSlots);
const b8Slot = mergedFresh.find((f) => f.winnerPickId === B8)?.slotIndex;
check(
  "B8 clinches a 0:3 slot from the merged record — the live fix",
  b8Slot !== undefined && slots("0:3").includes(b8Slot),
  `slot=${b8Slot}`,
);

console.log(`\nlive-results-bridge: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
