/**
 * Region verification (PHA-892) — offline, against the committed layout + the
 * pure region map the app renders from.
 *
 * Proves:
 *   1. coverage: every non-TBD layout team has a mapped region, so a chip
 *      renders for every team in the pool.
 *   2. validity: every region code resolves to REGION_META (label + color).
 *   3. no orphans: TEAM_REGIONS holds no pickid that isn't in the field.
 *   4. the issue's named buckets (NA, EU, SA) are all present in the field.
 *
 * Run:  node scripts/verify-regions.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TEAM_REGIONS,
  REGION_META,
  regionForPickid,
  regionMetaForPickid,
} from "../src/lib/regions-core.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const layout = JSON.parse(read("src/fixtures/cologne-layout.json")).result as {
  teams: { pickid: number; logo: string; name: string }[];
};

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

console.log("\nPHA-892 region verification\n");

const real = layout.teams.filter((t) => t.pickid !== 0);

// 1. coverage
console.log("[1] coverage");
const missing = real.filter((t) => regionForPickid(t.pickid) === null);
check(
  `all ${real.length} non-TBD teams have a region`,
  missing.length === 0,
  missing.length ? `missing: ${missing.map((t) => `${t.name}(${t.pickid})`).join(", ")}` : "0 gaps",
);

// 2. validity — every mapped code resolves to meta with a hex color.
console.log("\n[2] validity");
const badMeta = real
  .map((t) => ({ t, m: regionMetaForPickid(t.pickid) }))
  .filter(({ m }) => !m || !/^#[0-9a-f]{6}$/i.test(m.color));
check(
  "every team's region resolves to REGION_META with a hex color",
  badMeta.length === 0,
  badMeta.length ? badMeta.map(({ t }) => t.name).join(", ") : "all resolve",
);

// 3. no orphans — the map shouldn't carry pickids outside the field.
console.log("\n[3] no orphans");
const fieldIds = new Set(real.map((t) => t.pickid));
const orphans = Object.keys(TEAM_REGIONS)
  .map(Number)
  .filter((id) => !fieldIds.has(id));
check(
  "TEAM_REGIONS has no pickid outside the layout field",
  orphans.length === 0,
  orphans.length ? `orphans: ${orphans.join(", ")}` : "clean",
);

// 4. the issue's named buckets are represented.
console.log("\n[4] named buckets present");
const present = new Set(real.map((t) => regionForPickid(t.pickid)));
for (const code of ["NA", "EU", "SA"] as const) {
  check(`field includes a ${code} team`, present.has(code));
}

// distribution summary (informational)
const dist: Record<string, number> = {};
for (const t of real) {
  const r = regionForPickid(t.pickid)!;
  dist[r] = (dist[r] ?? 0) + 1;
}
console.log(
  "\n  distribution: " +
    Object.keys(REGION_META)
      .map((r) => `${r} ${dist[r] ?? 0}`)
      .join(" · "),
);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ` +
    `${real.length}/${real.length} teams regioned.\n`,
);
process.exit(failures === 0 ? 0 : 1);
