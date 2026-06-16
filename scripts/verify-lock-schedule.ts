/**
 * verify-lock-schedule - offline proof for PHA-856 (countdown clock data source).
 *
 * The countdown must NEVER fabricate a clock: it shows only when a real,
 * published lock instant exists for the section. This exercises
 * lockTimeForSection across: empty schedule (committed default -> null for
 * every layout section), a populated schedule (valid ISO -> echoed back),
 * and malformed/empty/garbage values (-> null, so the UI degrades to no clock).
 *
 * Run: node scripts/verify-lock-schedule.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  lockTimeForSection,
  isLockTimePassed,
  isWithinMatchWindow,
  isWithinRefreshWindow,
  bracketRevealTime,
  isBracketRevealed,
  BRACKET_REVEAL_LEAD_MS,
  COLOGNE_LOCK_SCHEDULE,
  COLOGNE_MATCH_WINDOWS,
  COLOGNE_PLAYOFF_SCHEDULE,
  playoffGameTime,
  type LockSchedule,
} from "../src/lib/lock-schedule-core.ts";
import type { Layout } from "../src/lib/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout: Layout = (
  JSON.parse(read("src/fixtures/cologne-layout.json")) as { result: Layout }
).result;

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

console.log("\nlock-schedule - committed Cologne schedule (PHA-865)");

// Swiss stages are lit with their day-1 first-match instant (12:30 CEST =
// 10:30 UTC). Playoff sections stay dark until the bracket schedule publishes.
const COMMITTED_LIT: Readonly<Record<number, string>> = {
  105: "2026-06-02T10:30:00Z",
  106: "2026-06-06T10:30:00Z",
  107: "2026-06-11T10:30:00Z",
};
const COMMITTED_DARK = [108, 109, 110];

for (const s of layout.sections) {
  const label = s.name.split(" | ")[0];
  const expected = COMMITTED_LIT[s.sectionid] ?? null;
  check(
    expected === null
      ? `section ${s.sectionid} (${label}) -> dark (no published lock time)`
      : `section ${s.sectionid} (${label}) -> ${expected}`,
    lockTimeForSection(s.sectionid) === expected,
  );
}
check(
  "playoff sections (108/109/110) all dark until bracket schedule publishes",
  COMMITTED_DARK.every((id) => lockTimeForSection(id) === null),
);
check(
  "every committed instant is a valid future-or-any ISO UTC value",
  Object.values(COLOGNE_LOCK_SCHEDULE).every(
    (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)),
  ),
);

console.log("\nlock-schedule - populated schedule resolves valid instants");

const populated: LockSchedule = {
  105: "2026-06-01T09:00:00Z",
  106: "2026-06-03T09:00:00Z",
};
check(
  "valid ISO is echoed back",
  lockTimeForSection(105, populated) === "2026-06-01T09:00:00Z",
);
check(
  "second valid ISO is echoed back",
  lockTimeForSection(106, populated) === "2026-06-03T09:00:00Z",
);
check(
  "section absent from schedule -> null",
  lockTimeForSection(999, populated) === null,
);

console.log("\nlock-schedule - malformed values degrade to null (no fake clock)");

const bad: LockSchedule = {
  1: "",
  2: "not-a-date",
  3: "soon-ish",
};
check("empty string -> null", lockTimeForSection(1, bad) === null);
check("non-date string -> null", lockTimeForSection(2, bad) === null);
check("garbage string -> null", lockTimeForSection(3, bad) === null);

console.log("\nlock-schedule - isLockTimePassed gates on a published instant (PHA-898)");

const lockMs = Date.parse("2026-06-02T10:30:00Z");
check(
  "before the instant -> not passed",
  isLockTimePassed(105, lockMs - 60_000) === false,
);
check(
  "exactly at the instant -> passed (lock is inclusive)",
  isLockTimePassed(105, lockMs) === true,
);
check(
  "after the instant -> passed",
  isLockTimePassed(105, lockMs + 60_000) === true,
);
check(
  "Stage III (Jun 11) not yet passed at Stage I's lock time",
  isLockTimePassed(107, lockMs) === false,
);
check(
  "a dark playoff section never reports passed (no published time)",
  isLockTimePassed(108, lockMs + 9_000_000_000) === false,
);

console.log("\nlock-schedule - match windows gate the live refresh to play days (PHA-902)");

const D = (iso: string) => Date.parse(iso);
// Stage I window: Jun 2–5.
check("Jun 1 (day before Stage I) -> off-day, no refresh", isWithinMatchWindow(105, D("2026-06-01T18:00:00Z")) === false);
check("Jun 2 first match (10:30 UTC) -> match day", isWithinMatchWindow(105, D("2026-06-02T10:30:00Z")) === true);
check("Jun 5 late evening -> still a match day", isWithinMatchWindow(105, D("2026-06-05T20:00:00Z")) === true);
check("Jun 6 (Stage I over) -> off-day, no refresh", isWithinMatchWindow(105, D("2026-06-06T12:00:00Z")) === false);
// Stage II window: Jun 6–9 (Stage I's off-day IS Stage II's match day).
check("Jun 6 -> Stage II match day", isWithinMatchWindow(106, D("2026-06-06T12:00:00Z")) === true);
check("Jun 9 evening -> Stage II match day", isWithinMatchWindow(106, D("2026-06-09T19:00:00Z")) === true);
check("Jun 10 -> Stage II over, off-day", isWithinMatchWindow(106, D("2026-06-10T12:00:00Z")) === false);
check("between stages (Jun 5 23:00 for Stage II) -> not yet", isWithinMatchWindow(106, D("2026-06-05T23:00:00Z")) === false);
check("a section with no committed window -> fail open (refresh allowed)", isWithinMatchWindow(999, D("2026-06-01T00:00:00Z")) === true);
check("malformed window -> fail open", isWithinMatchWindow(1, 0, { 1: { start: "nope", end: "nope" } }) === true);
check("every committed window has valid start<=end ISO", Object.values(COLOGNE_MATCH_WINDOWS).every(
  (w) => !Number.isNaN(Date.parse(w.start)) && !Number.isNaN(Date.parse(w.end)) && Date.parse(w.start) <= Date.parse(w.end),
));
check("Stage III window committed (Jun 11–14)", COLOGNE_MATCH_WINDOWS[107] !== undefined);

console.log("\nlock-schedule - bracket reveals 24h before lock (PHA-943)");

// Stage II locks Jun 6 10:30Z → reveal Jun 5 10:30Z.
const s2Lock = D("2026-06-06T10:30:00Z");
check("reveal lead is 24h", BRACKET_REVEAL_LEAD_MS === 24 * 60 * 60_000);
check("Stage II reveal = lock − 24h", bracketRevealTime(106) === "2026-06-05T10:30:00.000Z");
check("a dark playoff section has no reveal time", bracketRevealTime(108) === null);
check("25h before lock -> not revealed yet", isBracketRevealed(106, s2Lock - 25 * 60 * 60_000) === false);
check("exactly 24h before lock -> revealed (inclusive)", isBracketRevealed(106, s2Lock - 24 * 60 * 60_000) === true);
check("12h before lock -> revealed", isBracketRevealed(106, s2Lock - 12 * 60 * 60_000) === true);
check("after lock -> still revealed (bracket stays up)", isBracketRevealed(106, s2Lock + 60_000) === true);
check("playoff section (no lock) -> never auto-reveals by clock", isBracketRevealed(108, s2Lock + 9_000_000_000) === false);

console.log("\nlock-schedule - refresh window opens at reveal, closes at competition end (PHA-943)");

// Stage II: reveal Jun 5 10:30Z, window end Jun 9 23:59:59Z.
check("Jun 5 09:00 (before reveal) -> closed", isWithinRefreshWindow(106, D("2026-06-05T09:00:00Z")) === false);
check("Jun 5 11:00 (after reveal, was off-day under old gate) -> OPEN", isWithinRefreshWindow(106, D("2026-06-05T11:00:00Z")) === true);
check("Jun 6 12:00 (match day) -> open", isWithinRefreshWindow(106, D("2026-06-06T12:00:00Z")) === true);
check("Jun 9 evening -> open", isWithinRefreshWindow(106, D("2026-06-09T19:00:00Z")) === true);
check("Jun 10 (stage decided) -> closed", isWithinRefreshWindow(106, D("2026-06-10T12:00:00Z")) === false);
// The widened gate is strictly earlier than the old play-days-only gate.
check("reveal window is a superset of the old match window (Jun 6 noon)",
  isWithinMatchWindow(106, D("2026-06-06T12:00:00Z")) === true && isWithinRefreshWindow(106, D("2026-06-06T12:00:00Z")) === true);
check("Stage III refresh opens Jun 10 10:30Z (24h before its Jun 11 lock)",
  isWithinRefreshWindow(107, D("2026-06-10T10:00:00Z")) === false && isWithinRefreshWindow(107, D("2026-06-10T11:00:00Z")) === true);
check("section with no lock time -> falls back to match-window gate (open inside)",
  isWithinRefreshWindow(1, D("2026-06-01T00:00:00Z"), {}, { 1: { start: "2026-06-01T00:00:00Z", end: "2026-06-01T23:59:59Z" } }) === true);
check("section with no lock and no window -> fail open",
  isWithinRefreshWindow(999, D("2026-06-01T00:00:00Z"), {}, {}) === true);

console.log("\nlock-schedule - per-game playoff schedule (PHA-1007): dark by default, lights up when filled");

// Committed default is EMPTY → no playoff game times and no derived playoff
// locks. This is the truthful "stay dark until authoritative" default (same rule
// as the Swiss schedule) — proves today's behavior is unchanged.
check("committed playoff schedule is empty (dark default)", Object.keys(COLOGNE_PLAYOFF_SCHEDULE).length === 0);
check("no committed QF game time → null", playoffGameTime(108, 0) === null);
check("no derived playoff lock for 108 (countdown stays dark)", lockTimeForSection(108) === null);
check("no derived playoff lock for 110 (GF)", lockTimeForSection(110) === null);

// Inject a populated schedule (what Brandon's confirmed times become): each game
// echoes its instant, the lock derives from the EARLIEST game even out of order,
// a missing index / unknown section / bad ISO → null (never a fabricated time).
const injected = {
  108: ["2026-06-18T14:00:00Z", "2026-06-18T10:30:00Z"], // intentionally out of order
  110: ["2026-06-21T13:00:00Z"],
} as const;
check("injected QF game 1 echoes its instant", playoffGameTime(108, 0, injected) === "2026-06-18T14:00:00Z");
check("injected GF game echoes its instant", playoffGameTime(110, 0, injected) === "2026-06-21T13:00:00Z");
check("missing game index → null", playoffGameTime(108, 5, injected) === null);
check("unknown playoff section → null", playoffGameTime(109, 0, injected) === null);
check("bad ISO in schedule → null (no fabricated time)",
  playoffGameTime(108, 0, { 108: ["not-a-date"] }) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
