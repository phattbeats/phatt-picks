/**
 * verify-playoff-schedule - offline proof for PHA-5276.
 *
 * The playoff bracket's game times come from HLTV's event match list, and
 * nothing is ever estimated:
 *   - the real capture of Singapore's hub match list (8302, crawled 2026-11-27)
 *     parses into 4 QF, 2 SF and 1 GF time, the decider and Swiss rounds ignored;
 *   - the bracket lock derived from it is the first quarterfinal;
 *   - a round with a missing or untimed game is left out (stays dark);
 *   - committed games win, and a locked bracket never moves.
 *
 * Run: node scripts/verify-playoff-schedule.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyPlayoffLabel,
  hltvMatchListUrl,
  playoffMatchListSource,
  mergePlayoffProposal,
  parseHltvMatchList,
  proposePlayoffSchedule,
} from "../src/lib/playoff-schedule-core.ts";
import { derivePlayoffLocks } from "../src/lib/lock-schedule-core.ts";
import { BASE_EVENTS, mergeStageFacts, validateEventRevealConfig } from "../src/lib/events-core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../src/fixtures/hltv-sg-hub-matches.sample.html"), "utf8");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SG_NAMES = {
  111: "Stage I",
  112: "Stage II",
  113: "Stage III",
  114: "Quarterfinals",
  115: "Semifinals",
  116: "Grand Final",
};

// 1. Labels.
check("QF label", eq(classifyPlayoffLabel("PGL Major Singapore 2026 - Quarter-final #3"), { round: "qf", ordinal: 3 }));
check("SF label", eq(classifyPlayoffLabel("Semi-final #2"), { round: "sf", ordinal: 2 }));
check("GF label", eq(classifyPlayoffLabel("PGL Major Singapore 2026 - Grand Final"), { round: "gf", ordinal: 1 }));
check("decider ignored", classifyPlayoffLabel("PGL Major Singapore 2026 - 3rd Place Decider Match").round === null);
check("Swiss ignored", classifyPlayoffLabel("PGL Major Singapore 2026 - Swiss Round 5 #3").round === null);
check("registry name", eq(classifyPlayoffLabel("Quarterfinals"), { round: "qf", ordinal: null }));

// 2. Real capture.
const matches = parseHltvMatchList(html);
check("parses every listed match", matches.length === 41, `${matches.length}`);
check("all TBD today", matches.every((m) => m.team1 === null && m.team2 === null));
const proposal = proposePlayoffSchedule(matches, SG_NAMES);
const expected = {
  114: ["2026-12-10T09:00:00.000Z", "2026-12-10T12:00:00.000Z", "2026-12-11T09:00:00.000Z", "2026-12-11T12:00:00.000Z"],
  115: ["2026-12-12T09:00:00.000Z", "2026-12-12T12:00:00.000Z"],
  116: ["2026-12-13T10:00:00.000Z"],
};
check("Singapore proposal", eq(proposal, expected), JSON.stringify(proposal));
const locks = derivePlayoffLocks(proposal);
check(
  "bracket locks at first QF",
  [114, 115, 116].every((id) => Date.parse(locks[id] ?? "") === Date.parse("2026-12-10T09:00:00Z")),
  JSON.stringify(locks),
);

// 3. Never invent.
const noQf4 = matches.filter((m) => !(m.round === "qf" && m.ordinal === 4));
const partial = proposePlayoffSchedule(noQf4, SG_NAMES);
check("partial QF round left dark", !(114 in partial) && 115 in partial && 116 in partial);
const dupSf = [...matches, { ...matches.find((m) => m.round === "sf")!, matchId: 1 }];
check("ambiguous SF round left dark", !(115 in proposePlayoffSchedule(dupSf, SG_NAMES)));
check("empty page proposes nothing", eq(proposePlayoffSchedule(parseHltvMatchList("<html></html>"), SG_NAMES), {}));
check("untimed entry dropped", parseHltvMatchList('<div class="match-wrapper" data-match-id="9"><span class="line-clamp-3">Grand Final</span></div>').length === 0);
check("Swiss-only registry proposes nothing", eq(proposePlayoffSchedule(matches, { 111: "Stage I" }), {}));

// 4. Merge rules.
const before = Date.parse("2026-12-01T00:00:00Z");
const after = Date.parse("2026-12-10T09:00:01Z");
check("fills an empty schedule", eq(mergePlayoffProposal({ committed: {}, previous: {}, proposal, nowMs: before }), proposal));
const committed = { 116: ["2026-12-13T09:30:00Z"] };
const merged = mergePlayoffProposal({ committed, previous: {}, proposal, nowMs: before });
check("committed wins", eq(merged[116], committed[116]) && eq(merged[114], proposal[114]));
const moved = { ...proposal, 114: ["2026-12-10T10:00:00.000Z", ...proposal[114].slice(1)] };
check(
  "frozen once locked",
  eq(mergePlayoffProposal({ committed: {}, previous: proposal, proposal: moved, nowMs: after }), proposal),
);
check(
  "follows HLTV before lock",
  eq(mergePlayoffProposal({ committed: {}, previous: proposal, proposal: moved, nowMs: before })[114], moved[114]),
);

// 4. The committed Singapore schedule is exactly what HLTV lists (fast path).
const SG = BASE_EVENTS[27];
const sameInstants = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((t, i) => Date.parse(t) === Date.parse(b[i]));
check(
  "committed SG schedule matches the capture",
  [114, 115, 116].every((id) => sameInstants(SG.playoffSchedule[id], proposal[id])),
);
check("committed SG bracket locks 12-10 09:00Z", Date.parse(SG.lockSchedule[114]) === Date.parse("2026-12-10T09:00:00Z"));
check("committed SG passes the reveal guard", validateEventRevealConfig(SG).length === 0, validateEventRevealConfig(SG).join("; "));

// 5. Overlay (option a): an undated bracket takes HLTV's times from facts.
const undatedLocks = Object.fromEntries(
  Object.entries(SG.lockSchedule).filter(([k]) => !["114", "115", "116"].includes(k)),
);
const UNDATED = { ...SG, playoffSchedule: {}, lockSchedule: undatedLocks };
check("undated base passes the reveal guard", validateEventRevealConfig(UNDATED).length === 0);
const facts = Object.entries(proposal).map(([k, t]) => ({
  sectionId: Number(k),
  sourceUrl: "https://www.hltv.org/events/8302/matches",
  firstMatchAt: t[0],
  windowStart: null,
  windowEnd: null,
  gameTimes: t,
}));
const overlaid = mergeStageFacts(UNDATED, facts);
check("overlay fills the playoff schedule", eq(overlaid.playoffSchedule, proposal));
check("overlay derives the bracket lock", eq(
  [114, 115, 116].map((id) => overlaid.lockSchedule[id]),
  Array(3).fill("2026-12-10T09:00:00.000Z"),
));
check("overlaid config passes the reveal guard", validateEventRevealConfig(overlaid).length === 0, validateEventRevealConfig(overlaid).join("; "));
check("Swiss locks untouched by the playoff overlay", overlaid.lockSchedule[111] === UNDATED.lockSchedule[111]);
const lateEdit = facts.map((f) => (f.sectionId === 116 ? { ...f, gameTimes: ["2026-12-13T11:00:00Z"] } : f));
check("committed rounds win over the overlay", mergeStageFacts(SG, lateEdit) === SG);
check("partial facts: only that round dated",
  eq(Object.keys(mergeStageFacts(UNDATED, facts.filter((f) => f.sectionId === 116)).playoffSchedule), ["116"]));
check("a fact with a bad time is ignored",
  mergeStageFacts(UNDATED, [{ ...facts[0], gameTimes: ["not a time"] }]) === UNDATED);
check("a Swiss fact's gameTimes are ignored",
  !("111" in mergeStageFacts(UNDATED, [{ ...facts[0], sectionId: 111, firstMatchAt: null }]).playoffSchedule));

// 6. Where the match list lives.
check("match list url", hltvMatchListUrl("https://www.hltv.org/events/8302/pgl-major-singapore-2026") === "https://www.hltv.org/events/8302/matches");
check("non-HLTV url refused", hltvMatchListUrl("https://example.com/events/8302/x") === null);
check("hub from the last Swiss stage's discovered page", playoffMatchListSource({
  swissSectionIds: [111, 112, 113],
  sources: { 111: { url: "https://www.hltv.org/events/9303/stage-1" } },
  discovered: { 113: "https://www.hltv.org/events/8302/pgl-major-singapore-2026" },
}) === "https://www.hltv.org/events/8302/matches");
check("no hub known -> null", playoffMatchListSource({ swissSectionIds: [111, 112, 113], sources: {}, discovered: {} }) === null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-playoff-schedule: all checks passed");
