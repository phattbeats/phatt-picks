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

const CRAWL_URL = process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235";
const CRAWL_TOKEN = process.env.CRAWL4AI_API_TOKEN ?? "Phatt-tech-2026";
const CHECK_ONLY = process.argv.includes("--check");

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = resolve(HERE, "../src/lib/team-stats-core.ts");

/** pickid → HLTV team id, url slug, display name. The IEM Cologne 2026 field. */
interface Source {
  hltvId: number;
  slug: string;
  name: string;
}
const TEAM_SOURCES: Record<number, Source> = {
  12: { hltvId: 4608, slug: "natus-vincere", name: "Natus Vincere" },
  48: { hltvId: 5973, slug: "liquid", name: "Liquid" },
  59: { hltvId: 5995, slug: "g2", name: "G2" },
  60: { hltvId: 6665, slug: "astralis", name: "Astralis" },
  69: { hltvId: 7532, slug: "big", name: "BIG" },
  74: { hltvId: 4863, slug: "tyloo", name: "TYLOO" },
  80: { hltvId: 9215, slug: "mibr", name: "MIBR" },
  81: { hltvId: 7020, slug: "spirit", name: "Spirit" },
  85: { hltvId: 8297, slug: "furia", name: "FURIA" },
  87: { hltvId: 6673, slug: "nrg", name: "NRG" },
  89: { hltvId: 9565, slug: "vitality", name: "Vitality" },
  95: { hltvId: 7175, slug: "heroic", name: "HEROIC" },
  102: { hltvId: 4773, slug: "pain", name: "paiN" },
  104: { hltvId: 8113, slug: "sharks", name: "Sharks" },
  106: { hltvId: 4494, slug: "mouz", name: "MOUZ" },
  112: { hltvId: 9996, slug: "9z", name: "9z" },
  115: { hltvId: 9928, slug: "gamerlegion", name: "GamerLegion" },
  119: { hltvId: 11811, slug: "monte", name: "Monte" },
  122: { hltvId: 6248, slug: "the-mongolz", name: "The MongolZ" },
  126: { hltvId: 12468, slug: "legacy", name: "Legacy" },
  127: { hltvId: 8840, slug: "lynn-vision", name: "Lynn Vision" },
  132: { hltvId: 12774, slug: "flyquest", name: "FlyQuest" },
  134: { hltvId: 11861, slug: "aurora", name: "Aurora" },
  135: { hltvId: 11241, slug: "b8", name: "B8" },
  137: { hltvId: 12394, slug: "betboom", name: "BetBoom" },
  139: { hltvId: 11283, slug: "falcons", name: "Falcons" },
  140: { hltvId: 12376, slug: "m80", name: "M80" },
  142: { hltvId: 12467, slug: "parivision", name: "PARIVISION" },
  145: { hltvId: 13286, slug: "fut", name: "FUT" },
  146: { hltvId: 11571, slug: "gaimin-gladiators", name: "Gaimin Gladiators" },
  147: { hltvId: 10577, slug: "sinners", name: "SINNERS" },
  148: { hltvId: 13486, slug: "thunder-downunder", name: "THUNDER dOWNUNDER" },
};

interface Match {
  date: string;
  opponent: string;
  score: string;
  result: "W" | "L" | "T";
}

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

const ROW = /\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|([\s\S]+?)\|\s*\[Match\]/g;
const SCORE = /(\d+)\s*:\s*(\d+)/;
const TEAMLINK = /\[([^\][]+)\]\(https:\/\/www\.hltv\.org\/team\/\d+\/[a-z0-9-]+\)/g;

/** Parse up to 5 most-recent matches from a team page's markdown. */
function parseRecent(md: string): Match[] {
  const i = md.indexOf("Recent results");
  if (i < 0) return [];
  const seg = md.slice(i, i + 6000);
  const out: Match[] = [];
  for (const m of seg.matchAll(ROW)) {
    const date = m[1];
    const cell = m[2];
    const sc = SCORE.exec(cell);
    if (!sc) continue;
    const a = Number(sc[1]);
    const b = Number(sc[2]);
    const right = cell.slice(sc.index + sc[0].length);
    const opps = [...right.matchAll(TEAMLINK)].map((x) => x[1].trim());
    const opponent = opps[0] ?? "?";
    const result = a > b ? "W" : a < b ? "L" : "T";
    out.push({ date, opponent, score: `${a}-${b}`, result });
    if (out.length >= 5) break;
  }
  return out;
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
    lines.push(`    hltvUrl: "https://www.hltv.org/team/${src.hltvId}/${src.slug}",`);
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
