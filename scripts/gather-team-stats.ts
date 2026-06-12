/**
 * gather-team-stats — refresh the team dossier's recent results from HLTV.
 *
 * PHA-897 (Brandon): "the matches should update for each stage… build that in
 * for future majors as well. We need a pre-major checklist to get certain dates
 * and teams." This is the repeatable half of that: a one-command refresh of the
 * frozen snapshot in `src/lib/team-stats-core.ts`. Run it at each stage boundary
 * (see docs/PRE-MAJOR-CHECKLIST.md) and the dossier's "Last 5 matches" pick up
 * whatever each team has just played — Stage 1 results before Stage 2, etc.
 *
 * It re-crawls every team's HLTV profile via the in-network crawl4ai service,
 * parses the "Recent results" table, and rewrites the `recent[]`, `hltvUrl` and
 * `TEAM_STATS_AS_OF` of team-stats-core in place — preserving each team's
 * committed `worldRank` and `roster` (those move slowly; bump them by hand when
 * HLTV's weekly ranking shifts). Deterministic string parse, no LLM.
 *
 * Source of truth for the field is TEAM_SOURCES below: pickid → HLTV team id +
 * url slug + display name. For a NEW major, replace this map (the checklist
 * walks through getting the ids from the HLTV event + ranking pages) and re-run.
 *
 * Run (inside the phatt network, where crawl4ai is reachable):
 *   node --experimental-strip-types --no-warnings scripts/gather-team-stats.ts
 *   node … scripts/gather-team-stats.ts --check   # crawl + report, write nothing
 *
 * NOT part of the app build or CI — crawl4ai is only reachable from the deploy
 * network, so this is a manual dev/ops tool, same as scripts/spike-steam-auth.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TEAM_SOURCES,
  parseRecentResults,
  hltvProfileUrl,
  type ParsedMatch,
} from "../src/lib/team-stats-sources.ts";

const CRAWL_URL = process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235";
const CRAWL_TOKEN = process.env.CRAWL4AI_API_TOKEN ?? "Phatt-tech-2026";
const CHECK_ONLY = process.argv.includes("--check");

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = resolve(HERE, "../src/lib/team-stats-core.ts");

// The source map + recent-results parser are shared with the LIVE on-read refresh
// (src/lib/team-stats.ts) via team-stats-sources, so the manual snapshot and the
// automated cache can never drift in WHICH profile they read or HOW they parse it
// (PHA-921). This script is the by-hand path; the runtime is the automated one.
type Match = ParsedMatch;

async function crawl(url: string): Promise<string> {
  const res = await fetch(`${CRAWL_URL}/crawl`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRAWL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls: [url] }),
  });
  if (!res.ok) throw new Error(`crawl ${url}: HTTP ${res.status}`);
  const data = await res.json();
  const r = data.results?.[0] ?? data;
  const md = r.markdown;
  return typeof md === "string" ? md : (md?.raw_markdown ?? "");
}

/** Parse up to 5 most-recent matches from a team page's markdown (shared parser). */
function parseRecent(md: string): Match[] {
  return parseRecentResults(md);
}

/** Pull existing worldRank + roster (kept as-is) out of the committed core. */
function readExisting(src: string): Record<number, { name: string; rank: string; roster: string }> {
  const re =
    /(\d+):\s*\{\s*\/\/\s*([^\n]+)\n\s*worldRank:\s*(null|\d+),\s*\n\s*roster:\s*\[([^\]]*)\],/g;
  const out: Record<number, { name: string; rank: string; roster: string }> = {};
  for (const m of src.matchAll(re)) {
    out[Number(m[1])] = { name: m[2].trim(), rank: m[3], roster: m[4].trim() };
  }
  return out;
}

function todayUtc(): string {
  // DD/MM/YYYY of the newest gathered match drives nothing; the snapshot label
  // is just today's date in UTC. Derived here (this is a manual ops run).
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function emit(
  existing: Record<number, { name: string; rank: string; roster: string }>,
  gathered: Record<number, Match[]>,
  asOf: string,
): string {
  const header = `/**
 * Team statistics & standings (PHA-893) — pure data + helpers, keyed by Valve
 * pickid so the standalone verify script (plain Node, no \`@/\` alias) and the
 * client drawer both load the same map. Rendering lives in TeamStatsDrawer.
 *
 * Three facets per team, mirroring the issue: world STANDING (HLTV world ranking),
 * ROSTER (active five), and the FIVE most recent official matches. Sourced from
 * HLTV (hltv.org) on the date below; this is a frozen snapshot, not a live feed.
 * Re-run \`scripts/gather-team-stats.ts\` to refresh recent results + hltvUrl at
 * each stage boundary (PHA-897; see docs/PRE-MAJOR-CHECKLIST.md). Teams with no
 * entry (TBD slots, late swaps) resolve to null and the drawer degrades.
 */

export const TEAM_STATS_AS_OF = "${asOf}"; // HLTV world ranking + recent results snapshot

export type MatchResult = "W" | "L" | "T";

export interface RecentMatch {
  date: string; // DD/MM/YYYY, as published by the source
  opponent: string;
  score: string; // this team first, e.g. "2-1"
  result: MatchResult;
}

export interface TeamStats {
  worldRank: number | null; // HLTV world ranking position, null if unranked
  roster: string[]; // active lineup nicknames
  recent: RecentMatch[]; // most-recent first, up to 5
  hltvUrl: string; // canonical HLTV team profile (the dossier's data source)
}

/** pickid → frozen stats snapshot for the IEM Cologne 2026 field (32 teams). */

export const TEAM_STATS: Record<number, TeamStats> = {`;

  const lines: string[] = [header];
  for (const pid of Object.keys(TEAM_SOURCES)
    .map(Number)
    .sort((x, y) => x - y)) {
    const ex = existing[pid];
    const src = TEAM_SOURCES[pid];
    const recent = gathered[pid] ?? [];
    if (!ex) throw new Error(`pickid ${pid} missing from existing core`);
    lines.push(`  ${pid}: { // ${ex.name}`);
    lines.push(`    worldRank: ${ex.rank},`);
    lines.push(`    roster: [${ex.roster}],`);
    lines.push(`    recent: [`);
    for (const m of recent) {
      const opp = m.opponent.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      lines.push(
        `      { date: "${m.date}", opponent: "${opp}", score: "${m.score}", result: "${m.result}" },`,
      );
    }
    lines.push(`    ],`);
    lines.push(`    hltvUrl: "${hltvProfileUrl(src)}",`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(`/** Frozen stats for a pickid, or null for TBD / unknown teams. */`);
  lines.push(`export function statsForPickid(pickid: number): TeamStats | null {`);
  lines.push(`  return TEAM_STATS[pickid] ?? null;`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

async function main() {
  const src = readFileSync(CORE_PATH, "utf8");
  const existing = readExisting(src);
  const pids = Object.keys(TEAM_SOURCES).map(Number);
  if (Object.keys(existing).length !== pids.length) {
    throw new Error(
      `parsed ${Object.keys(existing).length} existing teams, expected ${pids.length}`,
    );
  }

  const gathered: Record<number, Match[]> = {};
  let empties = 0;
  for (const pid of pids) {
    const s = TEAM_SOURCES[pid];
    const url = `https://www.hltv.org/team/${s.hltvId}/${s.slug}`;
    let matches: Match[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        matches = parseRecent(await crawl(url));
        break;
      } catch (e) {
        if (attempt === 2) console.error(`  FAIL ${pid} ${s.name}: ${String(e)}`);
      }
    }
    if (matches.length === 0) empties++;
    gathered[pid] = matches;
    const head = matches[0];
    console.error(
      `  ${matches.length ? "OK  " : "EMPTY"} ${pid} ${s.name}` +
        (head ? `  (vs ${head.opponent} ${head.score})` : ""),
    );
  }

  const asOf = todayUtc();
  const next = emit(existing, gathered, asOf);

  if (CHECK_ONLY) {
    const changed = next !== src;
    console.error(
      `\n--check: ${pids.length - empties}/${pids.length} teams gathered; ` +
        `core would ${changed ? "CHANGE" : "be unchanged"} (as-of ${asOf}).`,
    );
    process.exit(0);
  }

  writeFileSync(CORE_PATH, next);
  console.error(
    `\nWrote ${CORE_PATH}: ${pids.length - empties}/${pids.length} teams, as-of ${asOf}.` +
      `\nReview the diff, run scripts/verify-team-stats.ts, then commit.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
