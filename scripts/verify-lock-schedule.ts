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
  COLOGNE_LOCK_SCHEDULE,
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
