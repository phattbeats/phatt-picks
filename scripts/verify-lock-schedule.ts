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

console.log("\nlock-schedule - committed default is empty (truthful no-clock)");

// Every section in the layout resolves to null under the committed schedule
// until Brandon commits the published times. This is the intended default:
// no fabricated countdown ships.
for (const s of layout.sections) {
  check(
    `section ${s.sectionid} (${s.name.split(" | ")[0]}) -> null on empty schedule`,
    lockTimeForSection(s.sectionid) === null,
  );
}
check(
  "committed schedule ships empty",
  Object.keys(COLOGNE_LOCK_SCHEDULE).length === 0,
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
