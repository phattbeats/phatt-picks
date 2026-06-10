/**
 * gather-roster — refresh each team's roster rating + HLTV profile link (PHA-992).
 *
 * The team dossier's roster used to be bare screennames; it now carries each
 * player's role, HLTV rating, and a link to their own HLTV profile. Two of those
 * are sourced and move over time — the RATING (HLTV's team-period average) and the
 * profile URL (id/slug) — so this is the repeatable refresh for them, the sibling
 * of scripts/gather-team-stats (which does the "Last 5 matches"). The POSITION is
 * editorial (HLTV publishes no structured role) and the NAME is the answer-key
 * lineup, so both are PRESERVED verbatim from the committed core — only rating and
 * hltvUrl are rewritten from the live crawl.
 *
 * It re-crawls every team's HLTV profile via the in-network crawl4ai service,
 * reads the "Players of {team}" table (shared parser in team-stats-sources), and
 * rewrites each player's `rating` + `hltvUrl` in src/lib/team-stats-core.ts in
 * place. A committed starter HLTV currently lists as BENCHED (a late swap) is
 * matched too, by nickname; an unmatched player keeps its existing rating/url and
 * is reported, never blanked. Deterministic string parse, no LLM.
 *
 * Run (inside the phatt network, where crawl4ai is reachable):
 *   node --experimental-strip-types --no-warnings scripts/gather-roster.ts
 *   node … scripts/gather-roster.ts --check   # crawl + report, write nothing
 *
 * NOT part of the app build or CI — crawl4ai is only reachable from the deploy
 * network, so this is a manual dev/ops tool, same as scripts/gather-team-stats.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TEAM_SOURCES,
  hltvProfileUrl,
  hltvPlayerUrl,
  parseRosterStarters,
  type ParsedRosterPlayer,
} from "../src/lib/team-stats-sources.ts";

const CRAWL_URL = process.env.CRAWL4AI_URL ?? "http://crawl4ai:11235";
const CRAWL_TOKEN = process.env.CRAWL4AI_API_TOKEN ?? "Phatt-tech-2026";
const CHECK_ONLY = process.argv.includes("--check");

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = resolve(HERE, "../src/lib/team-stats-core.ts");

interface ExistingPlayer {
  name: string;
  position: string;
  rating: string; // as written, e.g. "1.10"
  hltvUrl: string;
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

const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, "");

/** Pull the committed structured roster blocks (name/position/rating/hltvUrl). */
function readExisting(src: string): Record<number, ExistingPlayer[]> {
  const block =
    /(\d+):\s*\{\s*\/\/[^\n]+\n\s*worldRank:[^\n]+\n\s*roster:\s*\[([\s\S]*?)\n {4}\],/g;
  const row =
    /\{\s*name:\s*"([^"]+)",\s*position:\s*"([^"]+)",\s*rating:\s*([0-9.]+|null),\s*hltvUrl:\s*"([^"]+)"\s*\}/g;
  const out: Record<number, ExistingPlayer[]> = {};
  for (const b of src.matchAll(block)) {
    const players: ExistingPlayer[] = [];
    for (const m of b[2].matchAll(row)) {
      players.push({ name: m[1], position: m[2], rating: m[3], hltvUrl: m[4] });
    }
    out[Number(b[1])] = players;
  }
  return out;
}

/** Render one roster block body (the lines between `[` and `]`). */
function emitRoster(players: ExistingPlayer[]): string {
  return players
    .map(
      (p) =>
        `      { name: "${p.name}", position: "${p.position}", rating: ${p.rating}, hltvUrl: "${p.hltvUrl}" },`,
    )
    .join("\n");
}

async function main() {
  const src = readFileSync(CORE_PATH, "utf8");
  const existing = readExisting(src);
  const pids = Object.keys(TEAM_SOURCES).map(Number);
  const got = Object.keys(existing).length;
  if (got !== pids.length) {
    throw new Error(`parsed ${got} existing roster blocks, expected ${pids.length}`);
  }

  let out = src;
  let teamsChanged = 0;
  let unmatched = 0;
  for (const pid of pids) {
    const s = TEAM_SOURCES[pid];
    const url = hltvProfileUrl(s);
    let live: ParsedRosterPlayer[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Take every listed player, not just STARTERs, so a benched-but-committed
        // late swap is still matchable by nickname.
        live = parseRosterStarters(await crawl(url), false);
        if (live.length) break;
      } catch (e) {
        if (attempt === 2) console.error(`  FAIL ${pid} ${s.name}: ${String(e)}`);
      }
    }
    const byNick = new Map(live.map((p) => [norm(p.nick), p]));

    const before = existing[pid];
    const after: ExistingPlayer[] = before.map((p) => {
      const hit = byNick.get(norm(p.name));
      if (!hit) {
        unmatched++;
        console.error(`  KEEP  ${pid} ${s.name}: ${p.name} not on live profile, keeping existing`);
        return p;
      }
      return {
        ...p,
        rating: hit.rating.toFixed(2),
        hltvUrl: hltvPlayerUrl(hit.hltvId, hit.slug),
      };
    });

    // Splice the refreshed block back into the source by the team's block anchor.
    const anchor = new RegExp(
      `(${pid}:\\s*\\{\\s*//[^\\n]+\\n\\s*worldRank:[^\\n]+\\n\\s*roster:\\s*\\[)[\\s\\S]*?(\\n {4}\\],)`,
    );
    const replaced = out.replace(anchor, `$1\n${emitRoster(after)}$2`);
    if (replaced !== out) {
      out = replaced;
      const changed = JSON.stringify(after) !== JSON.stringify(before);
      if (changed) teamsChanged++;
      console.error(
        `  ${live.length ? "OK  " : "EMPTY"} ${pid} ${s.name}: ${live.length} listed${changed ? " (changed)" : ""}`,
      );
    } else {
      console.error(`  MISS ${pid} ${s.name}: could not splice roster block`);
    }
  }

  if (CHECK_ONLY) {
    console.error(
      `\n--check: ${teamsChanged} team(s) would change, ${unmatched} player(s) kept (unmatched). Nothing written.`,
    );
    process.exit(0);
  }

  writeFileSync(CORE_PATH, out);
  console.error(
    `\nWrote ${CORE_PATH}: ${teamsChanged} team(s) changed, ${unmatched} kept.` +
      `\nReview the diff, run scripts/verify-team-stats.ts + verify-roster-parse.ts, then commit.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
