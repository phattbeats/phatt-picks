/**
 * verify-team-accent - offline proof for PHA-1043 follow-up (Brandon: "each
 * spotlight needs its accent color to be the team's color").
 *
 * The spotlight modal keys every accent off the team's color; a team missing
 * from the TEAM_ACCENT map silently falls back to the house orange — i.e. it
 * would NOT honor the request. This guards that:
 *   • every team in the committed layout fixture has a mapped accent (no team
 *     quietly reverts to --heat);
 *   • each mapped accent is a valid 3/6-digit hex color (so the inline
 *     `--team-accent` style is always well-formed);
 *   • an unknown slug returns null (the documented fallback contract).
 *
 * Run: node scripts/verify-team-accent.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { teamAccent } from "../src/lib/playoff-spotlights.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

interface LayoutResult {
  result: { teams: { pickid: number; logo: string; name: string }[] };
}
const teams = (JSON.parse(read("src/fixtures/cologne-layout.json")) as LayoutResult)
  .result.teams;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

for (const t of teams) {
  const accent = teamAccent(t);
  check(`${t.name} (${t.logo}) has a mapped accent`, accent != null);
  if (accent != null) {
    check(`${t.name} (${t.logo}) accent is a valid hex`, HEX.test(accent));
  }
}

// — fallback contract: an unmapped slug yields null so the modal keeps --heat —
check("unknown slug → null", teamAccent({ logo: "__nope__" }) === null);

console.log(`\nverify-team-accent: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
