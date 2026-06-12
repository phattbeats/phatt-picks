/**
 * verify-swiss-results - offline proof for the live HLTV W-L standings (PHA-902).
 *
 * The pure core (swiss-results-core) parses the HLTV Swiss standings table out of
 * crawl4ai's page markdown, maps each row back to a committed layout team (for
 * logos + the viewer-pick highlight), and derives advance/eliminated status from
 * the W-L record. This loads a REAL captured snapshot of the live Stage I table
 * (src/fixtures/hltv-stage1-standings.sample.md, IEM Cologne Major 2026 Stage 1,
 * 02/06/26 after Round 2) and proves the parse + match + status logic against it,
 * plus the name-normalization edge cases and graceful-empty behavior.
 *
 * Run: node scripts/verify-swiss-results.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseHltvSwissStandings,
  matchStandingsToLayout,
  normalizeTeamName,
  deriveStatus,
  summarizeStandings,
  recordsByPickId,
  planStandingsCrawlPass,
  STANDINGS_CRAWL_PASS_TIMEOUT_MS,
  STANDINGS_MAX_CRAWL_PASSES,
  STANDINGS_MAX_TOTAL_CRAWL_MS,
} from "../src/lib/swiss-results-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;
const stage1: Section = layout.sections.find((s) => s.sectionid === 105)!;
const stageTeams = stage1.groups[0].teams
  .map((t) => t.pickid)
  .filter((id) => id !== 0)
  .map((id) => layout.teams.find((t) => t.pickid === id)!)
  .map((t) => ({ pickid: t.pickid, name: t.name }));

const sampleMd = read("src/fixtures/hltv-stage1-standings.sample.md");

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

console.log("\nswiss-results - parse the live HLTV Stage I standings table");

const raw = parseHltvSwissStandings(sampleMd);
check("parsed all 16 teams from the table", raw.length === 16, `got ${raw.length}`);
check("every row has a non-empty team name", raw.every((r) => r.name.length > 0));
check("every row parsed a W-L record (wins+losses === matches)",
  raw.every((r) => r.wins + r.losses === r.matches));
check("round diff === roundsWon - roundsLost on every row",
  raw.every((r) => r.roundDiff === r.roundsWon - r.roundsLost));
check("seeds parsed (every row has a world-ranking seed)",
  raw.every((r) => typeof r.seed === "number" && r.seed! > 0));

// Spot-check specific teams against the captured snapshot.
const byName = (n: string) => raw.find((r) => r.name === n);
check("BetBoom 2-0 (RW26/RL13/RD13)", (() => {
  const r = byName("BetBoom");
  return !!r && r.wins === 2 && r.losses === 0 && r.roundsWon === 26 && r.roundsLost === 13 && r.roundDiff === 13;
})());
check("Liquid 1-1 with negative round diff (-1)", (() => {
  const r = byName("Liquid");
  return !!r && r.wins === 1 && r.losses === 1 && r.roundDiff === -1;
})());
check("Gaimin Gladiators 0-2 (RD -21)", (() => {
  const r = byName("Gaimin Gladiators");
  return !!r && r.wins === 0 && r.losses === 2 && r.roundDiff === -21;
})());
check("source order preserved — BetBoom leads, Gaimin trails",
  raw[0].name === "BetBoom" && raw[raw.length - 1].name === "Gaimin Gladiators");

console.log("\nswiss-results - status derived from the record (3 wins adv / 3 losses elim)");

check("2-0 / 1-1 / 0-2 are all still 'live' (no clinch at <3)",
  raw.every((r) => deriveStatus(r.wins, r.losses) === "live"));
check("3-0 → advanced", deriveStatus(3, 0) === "advanced");
check("3-2 → advanced", deriveStatus(3, 2) === "advanced");
check("2-3 → eliminated", deriveStatus(2, 3) === "eliminated");
check("0-3 → eliminated", deriveStatus(0, 3) === "eliminated");
check("configurable threshold (2-win Swiss): 2-0 → advanced",
  deriveStatus(2, 0, 2, 2) === "advanced");

console.log("\nswiss-results - name normalization matches HLTV spelling to the layout");

check("'Liquid' ~ 'Team Liquid'", normalizeTeamName("Liquid") === normalizeTeamName("Team Liquid"));
check("'Sharks' ~ 'Sharks Esports'", normalizeTeamName("Sharks") === normalizeTeamName("Sharks Esports"));
check("'FlyQuest' ~ 'Flyquest' (case)", normalizeTeamName("FlyQuest") === normalizeTeamName("Flyquest"));
check("'TYLOO' ~ 'Tyloo' (case)", normalizeTeamName("TYLOO") === normalizeTeamName("Tyloo"));
check("'SINNERS' ~ 'Sinners' (case)", normalizeTeamName("SINNERS") === normalizeTeamName("Sinners"));
check("distinctive words are NOT stripped ('Gaimin Gladiators' keeps gladiators)",
  normalizeTeamName("Gaimin Gladiators") === "gaimingladiators");
check("two different orgs don't collide", normalizeTeamName("MIBR") !== normalizeTeamName("M80"));

console.log("\nswiss-results - match parsed rows to the committed Stage I layout");

const matched = matchStandingsToLayout(raw, stageTeams);
check("all 16 rows resolved to a layout pickid (logos will render)",
  matched.length === 16 && matched.every((r) => r.pickid !== null),
  `unmatched: ${matched.filter((r) => r.pickid === null).map((r) => r.name).join(", ") || "none"}`);
check("matched pickids are all distinct (no double-binding)",
  new Set(matched.map((r) => r.pickid)).size === 16);
check("matched pickids are all in the Stage I pool",
  matched.every((r) => stageTeams.some((t) => t.pickid === r.pickid)));

console.log("\nswiss-results - summary counts + graceful empty");

const summary = summarizeStandings(matched);
check("summary totals 16", summary.total === 16);
check("summary: started === true (matches played)", summary.started === true);
check("summary: live === 16 at this snapshot (none clinched yet)", summary.live === 16);
check("empty markdown → [] (graceful, no throw)", parseHltvSwissStandings("").length === 0);
check("markdown with no Swiss table → []", parseHltvSwissStandings("# just a page\nno table here").length === 0);
check("match on empty rows → [] (graceful)", matchStandingsToLayout([], stageTeams).length === 0);

console.log("\nswiss-results - recordsByPickId: partial W-L map for early-red (PHA-951)");

const records = recordsByPickId(matched);
check("every matched team with a game played has a record", records.size === 16);
check("records carry the parsed W-L (BetBoom 2-0)", (() => {
  const bb = matched.find((r) => r.name === "BetBoom");
  const rec = bb?.pickid != null ? records.get(bb.pickid) : undefined;
  return rec?.wins === 2 && rec?.losses === 0;
})());
check("a row with no game played (0-0) is omitted", (() => {
  const zero = matchStandingsToLayout(
    [{ seed: null, name: stageTeams[0].name, matches: 0, roundsWon: 0, roundsLost: 0, roundDiff: 0, wins: 0, losses: 0 }],
    stageTeams,
  );
  return recordsByPickId(zero).size === 0;
})());
check("unmatched rows (pickid null) are skipped", recordsByPickId([]).size === 0);

console.log("\nswiss-results - crawl retry/timeout policy (PHA-951: survive team-stats contention)");

check(
  "pass 0 gets the full per-attempt timeout",
  planStandingsCrawlPass(0, 0) === STANDINGS_CRAWL_PASS_TIMEOUT_MS,
);
check(
  "MAX_CRAWL_PASSES passes are schedulable from a fresh budget",
  Array.from({ length: STANDINGS_MAX_CRAWL_PASSES }, (_, i) => planStandingsCrawlPass(i, 0)).every(
    (t) => t != null && t > 0,
  ),
);
check(
  "a pass beyond MAX_CRAWL_PASSES yields null (stop retrying)",
  planStandingsCrawlPass(STANDINGS_MAX_CRAWL_PASSES, 0) === null,
);
check(
  "an exhausted total budget yields null even on an early pass",
  planStandingsCrawlPass(1, STANDINGS_MAX_TOTAL_CRAWL_MS) === null,
);
check(
  "the final pass is clamped to the remaining budget, not the per-pass cap",
  (() => {
    // Leave only 20s of budget: the pass must be clamped to that, not 90s.
    const left = 20_000;
    const t = planStandingsCrawlPass(1, STANDINGS_MAX_TOTAL_CRAWL_MS - left);
    return t === left && t < STANDINGS_CRAWL_PASS_TIMEOUT_MS;
  })(),
);
check(
  "a negative pass index is rejected (defensive)",
  planStandingsCrawlPass(-1, 0) === null,
);
check(
  "total budget covers at least two full per-attempt passes (real contention needs a real retry)",
  STANDINGS_MAX_TOTAL_CRAWL_MS >= 2 * STANDINGS_CRAWL_PASS_TIMEOUT_MS,
);

console.log(`\nswiss-results: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
