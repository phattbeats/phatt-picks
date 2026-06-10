/**
 * verify-team-stats — offline proof for PHA-893 team stats & standings.
 *
 * The dossier (roster / world standing / last 3 matches) is a frozen HLTV
 * snapshot keyed by Valve pickid, not a live feed. This script asserts the
 * dataset is well-formed and fully covers the 32-team IEM Cologne 2026 field,
 * so a typo can't silently ship a half-empty drawer.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/verify-team-stats.ts
 */

import {
  TEAM_STATS,
  TEAM_STATS_AS_OF,
  statsForPickid,
} from "../src/lib/team-stats-core.ts";

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

// The 32 pickids of the IEM Cologne 2026 field (same set as the layout / regions).
const FIELD = [
  12, 48, 59, 60, 69, 74, 80, 81, 85, 87, 89, 95, 102, 104, 106, 112, 115, 119,
  122, 126, 127, 132, 134, 135, 137, 139, 140, 142, 145, 146, 147, 148,
];

check("snapshot date is set", /^\d{4}-\d{2}-\d{2}$/.test(TEAM_STATS_AS_OF));
check("dataset has exactly 32 teams", Object.keys(TEAM_STATS).length === 32);

for (const pid of FIELD) {
  const s = statsForPickid(pid);
  check(`pickid ${pid}: present`, s !== null);
  if (!s) continue;
  check(
    `pickid ${pid}: worldRank is positive int or null`,
    s.worldRank === null || (Number.isInteger(s.worldRank) && s.worldRank > 0),
  );
  check(`pickid ${pid}: roster has 5 players`, s.roster.length === 5);
  check(
    `pickid ${pid}: roster names non-empty`,
    s.roster.every((p) => typeof p.name === "string" && p.name.trim().length > 0),
  );
  check(
    `pickid ${pid}: roster positions are IGL/AWP/Rifler`,
    s.roster.every((p) => ["IGL", "AWP", "Rifler"].includes(p.position)),
  );
  check(
    `pickid ${pid}: roster ratings are sane (0–2) or null`,
    s.roster.every(
      (p) => p.rating === null || (typeof p.rating === "number" && p.rating >= 0 && p.rating <= 2),
    ),
  );
  check(
    `pickid ${pid}: roster links are HLTV player profiles`,
    s.roster.every((p) => /^https:\/\/www\.hltv\.org\/player\/\d+\/[a-z0-9.-]+$/.test(p.hltvUrl)),
  );
  check(
    `pickid ${pid}: 1-5 recent matches`,
    s.recent.length >= 1 && s.recent.length <= 5,
  );
  check(
    `pickid ${pid}: hltvUrl is an HLTV team profile`,
    /^https:\/\/www\.hltv\.org\/team\/\d+\/[a-z0-9-]+$/.test(s.hltvUrl),
  );
  for (const m of s.recent) {
    const scoreOk = /^\d+-\d+$/.test(m.score);
    check(`pickid ${pid}: match vs ${m.opponent} score format`, scoreOk);
    check(
      `pickid ${pid}: match vs ${m.opponent} result is W/L/T`,
      m.result === "W" || m.result === "L" || m.result === "T",
    );
    if (scoreOk) {
      const [a, b] = m.score.split("-").map(Number);
      const expected = a > b ? "W" : a < b ? "L" : "T";
      check(
        `pickid ${pid}: match vs ${m.opponent} result matches score`,
        m.result === expected,
      );
    }
    check(
      `pickid ${pid}: match opponent non-empty`,
      m.opponent.trim().length > 0,
    );
  }
}

// TBD / unknown slots resolve to null — the drawer degrades gracefully.
check("unknown pickid 0 → null", statsForPickid(0) === null);
check("unknown pickid 9999 → null", statsForPickid(9999) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
