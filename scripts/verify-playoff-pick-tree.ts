/**
 * verify-playoff-pick-tree - offline proof for the interactive bracket predictor
 * (PHA-1204: "it is ONE stage, you place the whole bracket at once").
 *
 * buildPlayoffPickTree turns the committed QF/SF/GF sections into a feed tree —
 * each later match is fed by the two below it — and resolveBracketPicks walks
 * winner picks down it, advancing each crowned team into the round it feeds and
 * pruning any downstream pick orphaned by an upstream change. This proves:
 *   - the tree shape + feeder wiring (SF match j fed by QF 2j / 2j+1; GF by SFs),
 *   - QF picks advance into the SF participants, SF picks into the GF,
 *   - a full bracket resolves a champion,
 *   - re-picking an upstream match cascades the orphaned downstream picks away,
 *   - playoffFieldTeams = the eight QF survivors (the SF/GF eligibility universe),
 * all against the REAL committed layout (no hand-mocked sections).
 *
 * Run: node scripts/verify-playoff-pick-tree.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPlayoffPickTree,
  resolveBracketPicks,
  playoffFieldTeams,
  isPlayoffSection,
} from "../src/lib/playoff-bracket-core.ts";
import type { Layout, Section } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const layout: Layout = (JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }).result;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name + (detail ? `  (${detail})` : "")); }
}

function clone(sections: readonly Section[]): Section[] {
  return JSON.parse(JSON.stringify(sections)) as Section[];
}

const playoffSections = layout.sections.filter((s) => isPlayoffSection(s.sectionid));

// Seed all eight QF slots with real teams from the pool so SF/GF can derive.
const seeded = clone(playoffSections);
const qf = seeded.find((s) => s.sectionid === 108)!;
const sf = seeded.find((s) => s.sectionid === 109)!;
const gf = seeded.find((s) => s.sectionid === 110)!;
const T = layout.teams.slice(0, 8).map((t) => t.pickid); // 8 distinct survivors
qf.groups[0].teams = [{ pickid: T[0] }, { pickid: T[1] }];
qf.groups[1].teams = [{ pickid: T[2] }, { pickid: T[3] }];
qf.groups[2].teams = [{ pickid: T[4] }, { pickid: T[5] }];
qf.groups[3].teams = [{ pickid: T[6] }, { pickid: T[7] }];

const model = buildPlayoffPickTree(seeded);
const qfG = qf.groups.map((g) => g.groupid);
const sfG = sf.groups.map((g) => g.groupid);
const gfG = gf.groups[0].groupid;

console.log("\npick-tree - shape + feeder wiring");
check("3 rounds QF→SF→GF", model.rounds.map((r) => r.key).join(",") === "QF,SF,GF");
check("QF=4, SF=2, GF=1 matches", model.rounds[0].matches.length === 4 && model.rounds[1].matches.length === 2 && model.rounds[2].matches.length === 1);
check("finalGroupId is the GF group", model.finalGroupId === gfG);
check("QF matches carry seeds, no feeders", model.rounds[0].matches.every((m) => m.top.seed != null && m.top.feederGroupId == null));
check("SF Match 1 fed by QF 1 & QF 2", model.rounds[1].matches[0].top.feederGroupId === qfG[0] && model.rounds[1].matches[0].bottom.feederGroupId === qfG[1]);
check("SF Match 2 fed by QF 3 & QF 4", model.rounds[1].matches[1].top.feederGroupId === qfG[2] && model.rounds[1].matches[1].bottom.feederGroupId === qfG[3]);
check("GF fed by SF 1 & SF 2", model.rounds[2].matches[0].top.feederGroupId === sfG[0] && model.rounds[2].matches[0].bottom.feederGroupId === sfG[1]);

console.log("\npick-tree - empty state: only QF participants are known");
const empty = resolveBracketPicks(model, {});
check("QF1 participants are its two seeds", empty.participants.get(qfG[0])!.top === T[0] && empty.participants.get(qfG[0])!.bottom === T[1]);
check("SF/GF participants null until QF picks made", empty.participants.get(sfG[0])!.top === null && empty.participants.get(gfG)!.top === null);
check("no champion with no picks", empty.championPickid === null);

console.log("\npick-tree - QF picks advance into the SF, SF into the GF");
// Crown: QF1→T0, QF2→T2, QF3→T4, QF4→T6 ; SF1→T0, SF2→T4 ; GF→T0
const full = resolveBracketPicks(model, {
  [qfG[0]]: T[0], [qfG[1]]: T[2], [qfG[2]]: T[4], [qfG[3]]: T[6],
  [sfG[0]]: T[0], [sfG[1]]: T[4], [gfG]: T[0],
});
check("SF1 participants = QF1 & QF2 winners (T0, T2)", full.participants.get(sfG[0])!.top === T[0] && full.participants.get(sfG[0])!.bottom === T[2]);
check("SF2 participants = QF3 & QF4 winners (T4, T6)", full.participants.get(sfG[1])!.top === T[4] && full.participants.get(sfG[1])!.bottom === T[6]);
check("GF participants = SF winners (T0, T4)", full.participants.get(gfG)!.top === T[0] && full.participants.get(gfG)!.bottom === T[4]);
check("all 7 picks kept", Object.values(full.picks).filter((p) => p > 0).length === 7);
check("champion = GF winner T0", full.championPickid === T[0]);

console.log("\npick-tree - cascade: re-picking upstream prunes orphaned downstream");
// Flip QF1 winner T0 → T1. Now SF1 has {T1, T2}; the old SF1 pick (T0) and the
// GF pick (T0) are no longer in play and must drop.
const cascaded = resolveBracketPicks(model, {
  [qfG[0]]: T[1], [qfG[1]]: T[2], [qfG[2]]: T[4], [qfG[3]]: T[6],
  [sfG[0]]: T[0], [sfG[1]]: T[4], [gfG]: T[0],
});
check("SF1 now {T1, T2}", cascaded.participants.get(sfG[0])!.top === T[1] && cascaded.participants.get(sfG[0])!.bottom === T[2]);
check("orphaned SF1 pick (T0) dropped", cascaded.picks[sfG[0]] === undefined);
check("orphaned GF pick (T0) dropped", cascaded.picks[gfG] === undefined);
check("untouched QF/SF picks survive", cascaded.picks[qfG[1]] === T[2] && cascaded.picks[sfG[1]] === T[4]);
check("no champion after the orphaning", cascaded.championPickid === null);

console.log("\npick-tree - a pick for a team NOT in the match is rejected");
const bogus = resolveBracketPicks(model, { [qfG[0]]: T[5] }); // T5 plays in QF3, not QF1
check("off-match QF pick dropped", bogus.picks[qfG[0]] === undefined);

console.log("\npick-tree - playoffFieldTeams = the eight QF survivors");
const field = playoffFieldTeams(seeded);
check("field has 8 teams", field.size === 8, `got ${field.size}`);
check("field = T0..T7", T.every((t) => field.has(t)));
check("empty field pre-seeding", playoffFieldTeams(playoffSections).size === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
