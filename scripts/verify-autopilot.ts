/**
 * verify-autopilot — the Major autopilot's pure state model (PHA-1406).
 *
 * Proves, offline, that the five-minute self-check names the right human gap at
 * the right moment for a Singapore-shaped Major: Stage III dark until Stage II
 * locks, then a needs-human alert; the playoffs the same against Stage III; lock
 * drift against Valve in both directions; and the 12h re-alert policy.
 *
 * Run: node scripts/verify-autopilot.ts
 */
import {
  autopilotFindings,
  findingsToAlert,
  findingKey,
  sectionPhase,
  ALERT_REPEAT_MS,
  VALVE_LOCK_SLACK_MS,
  type SectionSnapshot,
} from "../src/lib/autopilot-core.ts";
import { EVENTS, playoffSectionIdsFor, sectionsInPlayOrder, validateEventRevealConfig, type EventConfig } from "../src/lib/events-core.ts";
import { derivePlayoffLocks, stageLocksFromSchedule } from "../src/lib/lock-schedule-core.ts";

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

const at = (iso: string) => Date.parse(iso);

function swiss(id: number, name: string, lockAt: string | null, extra: Partial<SectionSnapshot> = {}): SectionSnapshot {
  return {
    sectionId: id,
    name,
    kind: "swiss",
    lockAt,
    window: null,
    hasSource: lockAt !== null,
    seeded: 16,
    teamSlots: 16,
    valveOpen: null,
    resolved: 0,
    slots: 10,
    ...extra,
  };
}
function playoff(id: number, name: string, lockAt: string | null, extra: Partial<SectionSnapshot> = {}): SectionSnapshot {
  return {
    sectionId: id,
    name,
    kind: "playoff",
    lockAt,
    window: null,
    hasSource: false,
    seeded: 0,
    teamSlots: id === 114 ? 8 : id === 115 ? 4 : 2,
    valveOpen: null,
    resolved: 0,
    slots: id === 114 ? 4 : id === 115 ? 2 : 1,
    ...extra,
  };
}

/** Singapore as committed today: I + II dated, III + playoffs dark. */
function singapore(over: Record<number, Partial<SectionSnapshot>> = {}): SectionSnapshot[] {
  return [
    swiss(111, "Stage I", "2026-11-24T11:00:00Z", over[111]),
    swiss(112, "Stage II", "2026-11-28T11:00:00Z", over[112]),
    swiss(113, "Stage III", null, { seeded: 8, ...over[113] }),
    playoff(114, "Quarterfinals", null, over[114]),
    playoff(115, "Semifinals", null, over[115]),
    playoff(116, "Grand Final", null, over[116]),
  ];
}
const codes = (now: number, s: SectionSnapshot[], markets = 0) =>
  autopilotFindings({ sections: s, nowMs: now, marketsAuthored: markets }).map((f) => `${f.level}:${f.code}:${f.sectionId}`);

console.log("\nautopilot - the registry classifies Singapore by name, not by playoff times");
{
  const sg = sectionsInPlayOrder(EVENTS[27]);
  check("six sections in play order", sg.map((s) => s.sectionId).join() === "111,112,113,114,115,116");
  check("111-113 are Swiss, 114-116 playoff (playoffSchedule still empty)", sg.map((s) => s.kind).join() === "swiss,swiss,swiss,playoff,playoff,playoff");
  const cg = sectionsInPlayOrder(EVENTS[26]);
  check("Cologne classifies the same way", cg.map((s) => s.kind).join() === "swiss,swiss,swiss,playoff,playoff,playoff");
}

console.log("\nautopilot - publishing the bracket is one edit (invariant F)");
{
  const sg = EVENTS[27];
  const games = { 114: ["2026-12-10T08:00:00Z", "2026-12-10T11:30:00Z"], 115: ["2026-12-12T08:00:00Z"], 116: ["2026-12-13T09:00:00Z"] };
  const forgot: EventConfig = { ...sg, playoffSchedule: games };
  check("games without derived locks fail the registry check", validateEventRevealConfig(forgot).some((p) => p.includes("bracket lock")));
  const done: EventConfig = { ...sg, playoffSchedule: games, lockSchedule: { ...sg.lockSchedule, ...derivePlayoffLocks(games) } };
  check("spreading derivePlayoffLocks passes", validateEventRevealConfig(done).length === 0);
  check("every round locks at the first quarterfinal", Object.values(derivePlayoffLocks(games)).every((iso) => iso === "2026-12-10T08:00:00Z"));
  check("Singapore today passes (bracket unpublished)", validateEventRevealConfig(sg).length === 0);
  // One "Playoffs" reminder, not three, for Singapore's 114-116 (#1245 rule).
  const locks = stageLocksFromSchedule(done.lockSchedule, done.sectionNames, playoffSectionIdsFor(done));
  const playoffLocks = Object.keys(locks).map(Number).filter((id) => id >= 114);
  check("Singapore's playoff reminders collapse to one cutoff", playoffLocks.length === 1 && locks[playoffLocks[0]].name === "Playoffs");
  const viaCologneDefault = stageLocksFromSchedule(done.lockSchedule, done.sectionNames);
  check("(the Cologne default would have sent three)", Object.keys(viaCologneDefault).map(Number).filter((id) => id >= 114).length === 3);
}

console.log("\nautopilot - section phases");
{
  const s1 = swiss(111, "Stage I", "2026-11-24T11:00:00Z");
  check("more than 24h out → scheduled", sectionPhase(s1, at("2026-11-22T00:00:00Z")) === "scheduled");
  check("inside the 24h lead → revealed", sectionPhase(s1, at("2026-11-23T12:00:00Z")) === "revealed");
  check("past the lock → live", sectionPhase(s1, at("2026-11-24T11:00:00Z")) === "live");
  check("Valve closed before our clock → live", sectionPhase({ ...s1, valveOpen: false }, at("2026-11-22T00:00:00Z")) === "live");
  check("every slot resolved → decided", sectionPhase({ ...s1, resolved: 10 }, at("2026-11-27T00:00:00Z")) === "decided");
  check("no lock time → dark", sectionPhase(swiss(113, "Stage III", null), at("2026-11-20T00:00:00Z")) === "dark");
}

console.log("\nautopilot - today (2026-11-18): nothing needs a human");
{
  const now = at("2026-11-18T12:00:00Z");
  const f = codes(now, singapore());
  check("no needs-human finding", !f.some((c) => c.startsWith("needs-human")));
  check("Stage III is reported dark (info)", f.includes("info:undated-stage:113"));
  check("the playoffs are reported dark once, keyed on the QF (info)", f.filter((c) => c.includes("undated-stage")).length === 2 && f.includes("info:undated-stage:114"));
}

console.log("\nautopilot - Stage II locks with Stage III still undated → needs-human");
{
  const now = at("2026-11-28T11:05:00Z");
  const f = codes(now, singapore());
  check("undated-stage-next fires for 113", f.includes("needs-human:undated-stage-next:113"));
  check("the playoffs stay info (Stage III has not locked)", f.includes("info:undated-stage:114"));
  check("needs-human sorts first", f[0] === "needs-human:undated-stage-next:113");
  const early = codes(at("2026-11-28T10:55:00Z"), singapore());
  check("not a minute before Stage II locks", !early.includes("needs-human:undated-stage-next:113"));
  const byValve = codes(at("2026-11-28T10:00:00Z"), singapore({ 112: { valveOpen: false } }));
  check("Valve closing Stage II early counts as underway", byValve.includes("needs-human:undated-stage-next:113"));
}

console.log("\nautopilot - Stage III dated + locked, playoffs undated → needs-human for the bracket");
{
  const sec = singapore({ 113: { lockAt: "2026-12-03T11:00:00Z", hasSource: true, seeded: 16 } });
  const f = codes(at("2026-12-03T12:00:00Z"), sec);
  check("undated-stage-next fires once for the playoffs, keyed 114", f.filter((c) => c.startsWith("needs-human:undated-stage-next")).join() === "needs-human:undated-stage-next:114");
  check("Stage III no longer flagged", !f.some((c) => c.endsWith(":113") && c.includes("undated")));
}

console.log("\nautopilot - a dated stage in its reveal window with no HLTV source");
{
  const sec = singapore({ 113: { lockAt: "2026-12-03T11:00:00Z", hasSource: false } });
  check("flagged 23h before lock", codes(at("2026-12-02T12:00:00Z"), sec).includes("needs-human:no-source-before-reveal:113"));
  check("not flagged 3 days out", !codes(at("2026-11-30T11:00:00Z"), sec).includes("needs-human:no-source-before-reveal:113"));
  const decided = singapore({ 113: { lockAt: "2026-12-03T11:00:00Z", hasSource: false, resolved: 10 } });
  check("not flagged once decided", !codes(at("2026-12-07T00:00:00Z"), decided).some((c) => c.includes("no-source")));
}

console.log("\nautopilot - lock drift against Valve");
{
  const closedEarly = singapore({ 111: { valveOpen: false } });
  check("Valve closed before our lock → warn", codes(at("2026-11-23T00:00:00Z"), closedEarly).includes("warn:valve-closed-early:111"));
  const stillOpen = codes(at("2026-11-24T11:00:00Z") + VALVE_LOCK_SLACK_MS + 60_000, singapore({ 111: { valveOpen: true } }));
  check("Valve still open past slack → warn", stillOpen.includes("warn:valve-still-open:111"));
  const inSlack = codes(at("2026-11-24T11:10:00Z"), singapore({ 111: { valveOpen: true } }));
  check("within the slack → quiet", !inSlack.includes("warn:valve-still-open:111"));
  const unknown = codes(at("2026-11-25T00:00:00Z"), singapore({ 111: { valveOpen: null } }));
  check("no live layout cached → no drift claim", !unknown.some((c) => c.includes("valve-")));
  // The bracket locks as one at the first QF: a closed SF is not "early".
  const po = singapore({
    113: { lockAt: "2026-12-03T11:00:00Z", resolved: 10 },
    114: { lockAt: "2026-12-10T08:00:00Z", valveOpen: false, seeded: 8 },
    115: { lockAt: "2026-12-12T08:00:00Z", valveOpen: false },
    116: { lockAt: "2026-12-13T09:00:00Z", valveOpen: false },
  });
  const f = codes(at("2026-12-10T09:00:00Z"), po);
  check("playoffs locked at the first QF raise no drift for SF/GF", !f.some((c) => c.includes("valve-")));
}

console.log("\nautopilot - optional odds nudge");
{
  const sec = singapore({
    113: { lockAt: "2026-12-03T11:00:00Z", resolved: 10 },
    114: { lockAt: "2026-12-10T08:00:00Z", seeded: 8 },
  });
  check("seeded bracket, no markets → info", codes(at("2026-12-08T00:00:00Z"), sec, 0).includes("info:odds-unauthored:114"));
  check("markets authored → quiet", !codes(at("2026-12-08T00:00:00Z"), sec, 8).some((c) => c.includes("odds")));
}

console.log("\nautopilot - re-alert policy");
{
  const now = at("2026-11-28T12:00:00Z");
  const findings = autopilotFindings({ sections: singapore(), nowMs: now, marketsAuthored: 0 });
  const first = findingsToAlert(findings, new Map(), now);
  check("first sight alerts the needs-human finding only (info never alerts)", first.length === 1 && first[0].code === "undated-stage-next");
  const seen = new Map([[findingKey(first[0]), now]]);
  check("silent inside 12h", findingsToAlert(findings, seen, now + ALERT_REPEAT_MS - 1).length === 0);
  check("re-alerts at 12h while it persists", findingsToAlert(findings, seen, now + ALERT_REPEAT_MS).length === 1);
}

console.log(`\nautopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
