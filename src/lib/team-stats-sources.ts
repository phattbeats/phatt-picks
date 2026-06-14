/**
 * Team-stats source map + HLTV "Recent results" parser (pure, PHA-921).
 *
 * The single source of truth for WHICH HLTV profile backs each team and HOW to
 * read its recent matches — shared by two callers that must agree byte-for-byte:
 *
 *   1. `scripts/gather-team-stats.ts` — the manual, committed-snapshot refresh
 *      (PHA-897): re-crawl every profile and rewrite team-stats-core in place.
 *   2. `src/lib/team-stats.ts` — the LIVE on-read refresh (PHA-921): the same
 *      crawl + parse, but persisted to a cache and merged over the frozen
 *      snapshot at request time, so the dossier updates per stage on its own.
 *
 * Pure module — no `@/` alias, no prisma, no fetch — so the standalone verify
 * script (plain `node`) and the runtime both import it. The crawl/persist lives
 * in the callers; this file only knows the source map and the string parse.
 *
 * GENERALISE FOR A FUTURE MAJOR: replace `TEAM_SOURCES` (pickid → HLTV id/slug/
 * name) and the committed match windows in lock-schedule-core, and the live
 * refresh is config-only — no code change. The pre-major checklist walks through
 * getting the ids from the HLTV event + ranking pages.
 */

/** pickid → HLTV team id, url slug, display name. The IEM Cologne 2026 field. */
export interface TeamSource {
  hltvId: number;
  slug: string;
  name: string;
}

export const TEAM_SOURCES: Readonly<Record<number, TeamSource>> = {
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

import type { TeamStats } from "./team-stats-core";

/** A parsed recent match, mirroring team-stats-core's RecentMatch shape. */
export interface ParsedMatch {
  date: string; // DD/MM/YYYY, as published by the source
  opponent: string;
  score: string; // this team first, e.g. "2-1"
  result: "W" | "L" | "T";
}

/** The canonical HLTV team-profile url for a source entry. */
export function hltvProfileUrl(s: TeamSource): string {
  return `https://www.hltv.org/team/${s.hltvId}/${s.slug}`;
}

/**
 * Pull the HLTV team id out of a profile url — the stable `/team/<id>/<slug>`
 * segment (PHA-1044). The id survives the redirect-normalisation / trailing-slash
 * / http↔https rewrites crawl4ai applies to a result url, so it's the safe key to
 * match a crawl result back to the team we asked for. Returns null when no id is
 * present (a url we then can't safely attribute — the caller drops it rather than
 * guess by position). Pure: verify covers it offline.
 */
export function hltvTeamIdFromUrl(url: string | undefined | null): number | null {
  if (!url) return null;
  const m = url.match(/\/team\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : null;
}

/** The canonical HLTV player-profile url. */
export function hltvPlayerUrl(playerId: number, slug: string): string {
  return `https://www.hltv.org/player/${playerId}/${slug}`;
}

/** A roster player lifted off the team profile's "Players of X" table (PHA-992). */
export interface ParsedRosterPlayer {
  nick: string; // in-game nickname, as the profile link's text
  hltvId: number; // HLTV player id
  slug: string; // url slug
  rating: number; // HLTV team-period rating from the table's Rating column
}

// The team profile's "Players of {team}" table is one row per player:
//   | [flag nick](player/<id>/<slug>) | STATUS | time on team | maps | rating |
// We read the STARTER rows (the active five). The status filter is applied by the
// caller so a benched-but-committed player (a late lineup change) can still be
// matched by nickname. Same deterministic-string-parse discipline as parseRecentResults.
const PLAYER_ROW =
  /([A-Za-z0-9_.\-]+)\s*\]\(https:\/\/www\.hltv\.org\/player\/(\d+)\/([a-z0-9.-]+)\)\s*\|\s*(STARTER|BENCHED|INACTIVE)\s*\|[^|]*\|\s*[0-9,]+\s*\|\s*([0-9.]+)/g;

/**
 * Parse the active-lineup players (name / id / slug / rating) from a team
 * profile's markdown (PHA-992). Scans only the "Players of …" section so news
 * tables elsewhere on the page can't leak in. `status` keeps STARTER rows by
 * default; pass `false` to take every listed player (so a committed starter who
 * HLTV currently lists as BENCHED — a late swap — is still found). Returns [] when
 * the section or a parseable row is absent, so the caller keeps the prior data.
 */
export function parseRosterStarters(md: string, startersOnly = true): ParsedRosterPlayer[] {
  const i = md.indexOf("Players of");
  if (i < 0) return [];
  // Bound the scan to this section: from the header to the next markdown heading
  // (capped at 4000 chars), so a STARTER row in an unrelated table below can't leak
  // in. `i` sits inside the "## Players of …" header, so start the next-heading
  // search past it.
  const rest = md.slice(i + 10);
  const nextHeading = rest.indexOf("\n## ");
  const end = nextHeading >= 0 ? Math.min(nextHeading + 10, 4000) : 4000;
  const seg = md.slice(i, i + end);
  const out: ParsedRosterPlayer[] = [];
  for (const m of seg.matchAll(PLAYER_ROW)) {
    if (startersOnly && m[4] !== "STARTER") continue;
    out.push({
      nick: m[1],
      hltvId: Number(m[2]),
      slug: m[3],
      rating: Number(m[5]),
    });
  }
  return out;
}

/** Every (pickid, url) pair to crawl — input to the batch refresh. */
export function teamStatsCrawlTargets(): Array<{ pickid: number; url: string }> {
  return Object.entries(TEAM_SOURCES).map(([pid, s]) => ({
    pickid: Number(pid),
    url: hltvProfileUrl(s),
  }));
}

// HLTV renders the profile's "Recent results" as a markdown table; each row is a
// date cell, a team/score cell, and a [Match] link. Same patterns the gather
// tool has used since PHA-897 — kept here so the live path and the manual tool
// can never drift in how they read a row.
const ROW = /\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|([\s\S]+?)\|\s*\[Match\]/g;
const SCORE = /(\d+)\s*:\s*(\d+)/;
const TEAMLINK = /\[([^\][]+)\]\(https:\/\/www\.hltv\.org\/team\/\d+\/[a-z0-9-]+\)/g;

/**
 * Parse up to 5 most-recent matches from a team profile's markdown. The score is
 * the team's own first ("a:b" → "a-b"), the opponent is the first team-link to
 * the right of the score, and W/L/T is derived from the score (never from a
 * source label). Returns [] when the section or a parseable row is absent — the
 * caller then keeps the prior cache / frozen snapshot rather than blanking it.
 * Deterministic string parse, no LLM — identical logic in the gather tool.
 */
export function parseRecentResults(md: string): ParsedMatch[] {
  const i = md.indexOf("Recent results");
  if (i < 0) return [];
  const seg = md.slice(i, i + 6000);
  const out: ParsedMatch[] = [];
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
    const result: ParsedMatch["result"] = a > b ? "W" : a < b ? "L" : "T";
    out.push({ date, opponent, score: `${a}-${b}`, result });
    if (out.length >= 5) break;
  }
  return out;
}

// ── Multi-pass retry policy (pure, crawl injected) ─────────────────────────────
// A single ingest re-tries the teams that came back without a parseable results
// table (HLTV intermittently serves a Cloudflare challenge instead of the
// profile, especially while the standings crawl is also running). The manual
// gather tool retries per-url for exactly this reason and lands 32/32; the live
// path mirrors that. Each pass crawls only the still-missing teams, so the cost
// scales with the misses, not the field. Proven live: 27/32 → 31/32 → 32/32.
export const MAX_CRAWL_PASSES = 3;
// ~120s measured for the full field; the 240s ceiling keeps the original
// per-pass headroom over a slow render…
export const CRAWL_PASS_TIMEOUT_MS = 240_000;
// …but a total wall-clock budget across ALL passes bounds the whole multi-pass
// ingest at ~5min, so a slow crawl4ai (e.g. contending with the standings crawl
// on the same instance) can't run the full 3×240s (~12min) inside one after()
// task. `remaining` shrinks monotonically, so this is a ceiling, not a thrash.
export const MAX_TOTAL_CRAWL_MS = 300_000;

// ── Crawl blast-radius caps (PHA-1036) ─────────────────────────────────────────
// Handing crawl4ai all 32 URLs in one request lets ITS dispatcher render them all
// at once — on an uncapped container that lights every core (~460% CPU spike,
// froze the box). We instead split the field into small sub-batches sent as
// SEQUENTIAL crawl4ai requests, so the renderer never holds more than
// CRAWL_CHUNK_SIZE Chromium contexts at a time. Bonus: fewer simultaneous HLTV
// hits also trips Cloudflare less, the original reason this was a single request.
export const CRAWL_CHUNK_SIZE = 4;
// Per-sub-batch timeout ceiling (still bounded by the per-pass / total budget).
// With domcontentloaded + a tight page_timeout, a 4-page chunk renders in well
// under this; the ceiling just keeps one stuck chunk from eating a whole pass.
export const CRAWL_CHUNK_TIMEOUT_MS = 60_000;
// Per-page render cap handed to crawl4ai (page_timeout). The freeze came from
// ~50s/page waits on networkidle that never settles behind Cloudflare; cap the
// wait so a wedged page fails fast instead of burning a core for a minute.
export const CRAWL_PAGE_TIMEOUT_MS = 20_000;

/** Injected crawl: a set of (pickid,url) targets → pickid → page markdown. */
export type CrawlProfilesFn = (
  targets: ReadonlyArray<{ pickid: number; url: string }>,
  timeoutMs: number,
) => Promise<Record<number, string>>;

/**
 * Run up to MAX_CRAWL_PASSES crawl passes, accumulating parsed recent results and
 * re-crawling only the still-missing teams (PHA-921 / PHA-944). Two robustness
 * properties, both because HLTV intermittently challenges the crawl:
 *
 *  1. PARTIAL-SAFE — a pass that THROWS (transient crawl4ai 5xx / timeout, the
 *     exact Cloudflare condition the retry exists for) does NOT discard the
 *     `fresh` accumulated by earlier passes: it breaks and returns what landed so
 *     far, so the caller still persists partial coverage. The next ~1h tick
 *     re-pulls the still-missing teams. (Before PHA-944 the throw unwound past the
 *     caller's persist, discarding a good earlier pass.)
 *  2. BOUNDED — a total wall-clock budget (MAX_TOTAL_CRAWL_MS) caps the whole
 *     multi-pass duration; once the budget is spent it persists what it has.
 *  3. PARSE-ISOLATED — each team's parse runs in its own try/catch, so a single
 *     malformed profile (e.g. HLTV reformats one page, or a future parser swap
 *     throws on an edge case) can't drop the other teams in the same pass OR the
 *     `fresh` from earlier passes. Future-proofs the partial-safe guarantee
 *     against parser changes, not just crawl-transport failures.
 *
 * Pure: `crawl`, `parse`, and the clock are injected, so the verify harness
 * proves the retry/accumulate/partial-discard behaviour offline (no network).
 *
 * Field-size-agnostic: the work-list is whatever `targets` is passed (today the
 * 32-team Cologne field via teamStatsCrawlTargets, a future major's field after
 * swapping TEAM_SOURCES) — no hardcoded count. The pass/budget constants are
 * tuned for ~32 profiles (~120s full field); a much larger field would land
 * partial under the budget and finish on the next ~1h tick, never wedge.
 */
export async function accumulateRecentAcrossPasses(
  targets: ReadonlyArray<{ pickid: number; url: string }>,
  crawl: CrawlProfilesFn,
  parse: (md: string) => ParsedMatch[] = parseRecentResults,
  nowMs: () => number = Date.now,
): Promise<Record<number, ParsedMatch[]>> {
  const fresh: Record<number, ParsedMatch[]> = {};
  let remaining: ReadonlyArray<{ pickid: number; url: string }> = targets;
  const deadline = nowMs() + MAX_TOTAL_CRAWL_MS;
  for (let pass = 0; pass < MAX_CRAWL_PASSES && remaining.length > 0; pass++) {
    const budget = deadline - nowMs();
    if (budget <= 0) {
      console.warn(
        `[team-stats] crawl budget spent after ${pass} pass(es); persisting ${Object.keys(fresh).length} accumulated`,
      );
      break;
    }
    let mdByPickid: Record<number, string>;
    try {
      mdByPickid = await crawl(remaining, Math.min(CRAWL_PASS_TIMEOUT_MS, budget));
    } catch (e) {
      // Don't let a transient failure on a later pass discard earlier passes.
      console.warn(
        `[team-stats] pass ${pass + 1} crawl threw; persisting ${Object.keys(fresh).length} from earlier pass(es):`,
        e instanceof Error ? e.message : e,
      );
      break;
    }
    for (const [pid, md] of Object.entries(mdByPickid)) {
      try {
        const matches = parse(md);
        if (matches.length > 0) fresh[Number(pid)] = matches;
      } catch (e) {
        // A malformed single profile must not drop the rest of this pass or the
        // accumulated earlier passes — skip just this team (PHA-944 hardening).
        console.warn(
          `[team-stats] parse failed for pickid ${pid}; skipping that team:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    remaining = targets.filter((t) => !(t.pickid in fresh));
    if (remaining.length > 0) {
      console.warn(
        `[team-stats] pass ${pass + 1}: ${remaining.length} team(s) still missing, retrying`,
      );
    }
  }
  return fresh;
}

/**
 * Merge live recent results over a team's frozen snapshot (PHA-921). The live
 * crawl only refreshes `recent[]` (and back-fills hltvUrl) — roster + world rank
 * stay frozen, since those move slowly and aren't on the profile's results table.
 * When the live crawl produced no matches for this team (parse miss / hadn't
 * played), the frozen snapshot is returned unchanged, so the dossier never blanks
 * a team and never shows a fabricated result. Pure — the read path's core, tested
 * offline by the verify harness.
 */
export function mergeLiveStats(
  frozen: TeamStats,
  liveRecent: ParsedMatch[] | undefined,
  source: TeamSource,
): TeamStats {
  if (!Array.isArray(liveRecent) || liveRecent.length === 0) return frozen;
  return {
    ...frozen,
    recent: liveRecent as TeamStats["recent"],
    hltvUrl: frozen.hltvUrl || hltvProfileUrl(source),
  };
}
