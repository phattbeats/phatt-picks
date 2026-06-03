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
  COLOGNE_LOCK_SCHEDULE,
  COLOGNE_MATCH_WINDOWS,
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
