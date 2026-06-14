/**
 * Live Swiss W-L standings (pure, PHA-902).
 *
 * Where swiss-standings-core builds the viewer's clinch-bucket lineup from
 * Valve's answer key, THIS module shapes the real HLTV/BLAST-style standings:
 * every team's running win-loss record, rounds for/against, and advance /
 * eliminated status. Valve's Pick'Em answer key carries no running record (only
 * the final 3:0 / advanced / 0:3 bucket as teams clinch), so this needs an
 * external source — HLTV's event page. This module is the pure, testable seam:
 * it parses the HLTV Swiss standings table out of crawl4ai's markdown and maps
 * each row back to a layout team so the existing logo cascade can render it.
 *
 * TRUTHFUL BY CONSTRUCTION (same contract as the rest of the app): every field
 * here is read straight from the source table — we never invent a record. A row
 * we can't parse is dropped; a team we can't map to the layout is still shown by
 * the source's own name (it just falls back to a monogram for the logo).
 *
 * Pure leaf module: no `@/` alias, no prisma, no fetch — so the verify harness
 * imports it directly under `node` (mirrors swiss-standings-core, outcomes-core).
 */

/** Advance / eliminated / still-playing, derived from the W-L record. */
export type SwissResultStatus = "advanced" | "eliminated" | "live";

/** A standings row exactly as parsed from the source table (pre layout match). */
export interface RawStandingRow {
  /** Source world-ranking seed shown in the table (e.g. 17 for "#17"). null if absent. */
  seed: number | null;
  /** Team name as the source prints it (e.g. "Liquid", "TYLOO"). */
  name: string;
  /** Matches played this stage. */
  matches: number;
  /** Rounds won / lost / differential across all maps this stage. */
  roundsWon: number;
  roundsLost: number;
  roundDiff: number;
  /** Series wins / losses — the W-L record (e.g. 2 and 0 for "2 - 0"). */
  wins: number;
  losses: number;
}

/** A standings row matched to a layout team so logos + viewer-pick highlight work. */
export interface StandingRow extends RawStandingRow {
  /** Layout pickid for the matched team, or null when the name didn't resolve. */
  pickid: number | null;
  status: SwissResultStatus;
}

/** Just enough of a layout team to match a name and key a logo. */
export interface MatchableTeam {
  pickid: number;
  name: string;
}

/**
 * Derive advance / eliminated / live from a W-L record. A standard 16-team Swiss
 * advances at 3 wins and eliminates at 3 losses; both are parameterized so a
 * differently-sized Swiss (or a BLAST GSL-ish 2-win format) stays correct.
 */
export function deriveStatus(
  wins: number,
  losses: number,
  advanceAt = 3,
  eliminateAt = 3,
): SwissResultStatus {
  if (wins >= advanceAt) return "advanced";
  if (losses >= eliminateAt) return "eliminated";
  return "live";
}

/**
 * Normalize a team name for cross-source matching. HLTV and our committed layout
 * spell the same org slightly differently ("Liquid" vs "Team Liquid", "Sharks"
 * vs "Sharks Esports", "FlyQuest" vs "Flyquest"), so we lowercase, strip generic
 * org words and all non-alphanumerics, leaving a stable key. We only strip words
 * that are pure boilerplate — never a distinctive part of the name (so "Gaimin
 * Gladiators" keeps "gladiators").
 */
const BOILERPLATE = new Set(["team", "esports", "esport", "gaming", "club", "academy"]);
export function normalizeTeamName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !BOILERPLATE.has(w))
    .join("");
}

/**
 * Parse the HLTV Swiss standings table out of crawl4ai's page markdown. The
 * table renders as GitHub-flavored markdown rows; the header carries the
 * "Record" column ("| Group Swiss | M | RW | RL | RD | Record | E |") and each
 * body row looks like:
 *
 *   |  #17 ![BetBoom](logo) [BetBoom](team/12394/betboom) 2 26 13 13 2 - 0 [ ... ] |
 *
 * We anchor on the header, then read each subsequent table row, pulling the team
 * name from its team-page link and the six numbers + W-L record from the tail.
 * Anything that doesn't match the row shape (the separator, trailing match
 * cells) is skipped. Never throws: a malformed table yields [].
 */
const HEADER_RE = /\|\s*Group\s+Swiss\b.*\bRecord\b/i;
// Team name from the canonical team-page link: [Name](https://www.hltv.org/team/<id>/<slug>)
const TEAM_LINK_RE = /\[([^\]]+)\]\((?:https?:)?\/\/[^)]*\/team\/\d+\/[^)]*\)/i;
// The numeric tail: M RW RL RD  W - L   (RD may be negative)
const STATS_RE = /(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s*-\s*(\d+)/;
const SEED_RE = /#(\d+)/;

/**
 * Is (wins, losses, matches) a plausible Swiss record? (PHA-1044) STATS_RE binds
 * the first `N N N ±N N-N` run on a row, but a stray map score in the cell (e.g.
 * "13-7") could be mis-read as wins=13 / losses=7 → a fake "advanced". A real
 * Swiss record satisfies: non-negative integers, neither side past its clinch
 * threshold (≤3 wins / ≤3 losses by default), and matches === wins + losses (no
 * byes or ties in Swiss). A row that fails is a misparse and is dropped.
 */
export function isValidSwissRecord(
  wins: number,
  losses: number,
  matches: number,
  advanceAt = 3,
  eliminateAt = 3,
): boolean {
  if (![wins, losses, matches].every((n) => Number.isInteger(n) && n >= 0)) return false;
  if (wins > advanceAt || losses > eliminateAt) return false;
  return matches === wins + losses;
}

export function parseHltvSwissStandings(markdown: string): RawStandingRow[] {
  const lines = markdown.split("\n");
  const i = lines.findIndex((l) => HEADER_RE.test(l));
  if (i < 0) return [];
  const rows: RawStandingRow[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j].trim();
    if (!line.startsWith("|")) break; // table ended
    if (/^\|\s*-{2,}/.test(line) || /^\|(\s*---\s*\|)+/.test(line)) continue; // separator row
    const nameMatch = line.match(TEAM_LINK_RE);
    const stats = line.match(STATS_RE);
    if (!nameMatch || !stats) continue; // header repeat / malformed / non-team row
    const matches = Number(stats[1]);
    const wins = Number(stats[5]);
    const losses = Number(stats[6]);
    // Bound check: a stray map score (e.g. "13-7") binding as the W-L record would
    // fake an "advanced" clinch. Drop any row whose numbers aren't a valid Swiss
    // record rather than feed a fabricated standing downstream (PHA-1044).
    if (!isValidSwissRecord(wins, losses, matches)) continue;
    rows.push({
      seed: line.match(SEED_RE) ? Number(line.match(SEED_RE)![1]) : null,
      name: nameMatch[1].trim(),
      matches,
      roundsWon: Number(stats[2]),
      roundsLost: Number(stats[3]),
      roundDiff: Number(stats[4]),
      wins,
      losses,
    });
  }
  return rows;
}

/**
 * Match parsed rows to layout teams (for logos + the "your pick" highlight) and
 * attach the derived status. Order is preserved from the source (HLTV sorts by
 * standing). A row whose name doesn't resolve keeps pickid: null and still
 * renders by name.
 */
export function matchStandingsToLayout(
  rows: readonly RawStandingRow[],
  teams: readonly MatchableTeam[],
  opts: { advanceAt?: number; eliminateAt?: number } = {},
): StandingRow[] {
  const byNorm = new Map<string, number>();
  for (const t of teams) {
    const key = normalizeTeamName(t.name);
    if (key && !byNorm.has(key)) byNorm.set(key, t.pickid);
  }
  return rows.map((r) => ({
    ...r,
    pickid: byNorm.get(normalizeTeamName(r.name)) ?? null,
    status: deriveStatus(r.wins, r.losses, opts.advanceAt, opts.eliminateAt),
  }));
}

/**
 * Reduce matched standings rows to a pickid → partial W-L record map (PHA-951).
 * Only rows mapped to a layout team AND with at least one game played are kept,
 * so an all-zero pre-match row never falsely rules a pick out. Feeds the early-red
 * predicate (isBucketImpossibleByRecord): a 0:3 pick whose team has already won a
 * game, or a 3:0 pick whose team has lost one, can be struck red before the team
 * is terminally resolved.
 */
export function recordsByPickId(
  rows: readonly StandingRow[],
): Map<number, { wins: number; losses: number }> {
  const map = new Map<number, { wins: number; losses: number }>();
  for (const r of rows) {
    if (r.pickid != null && (r.wins > 0 || r.losses > 0)) {
      map.set(r.pickid, { wins: r.wins, losses: r.losses });
    }
  }
  return map;
}

/** Summary counts for the standings header copy. */
export interface StandingsSummary {
  total: number;
  advanced: number;
  eliminated: number;
  live: number;
  /** True once any series has been played (any row with matches > 0). */
  started: boolean;
}

export function summarizeStandings(rows: readonly StandingRow[]): StandingsSummary {
  return {
    total: rows.length,
    advanced: rows.filter((r) => r.status === "advanced").length,
    eliminated: rows.filter((r) => r.status === "eliminated").length,
    live: rows.filter((r) => r.status === "live").length,
    started: rows.some((r) => r.matches > 0),
  };
}

// --- Standings crawl retry/timeout policy (PHA-951 follow-up) ----------------
//
// The single HLTV event page renders in ~5s through crawl4ai when the service is
// idle — but the standings ingest fires in the SAME deferred tick as the
// team-stats refresh, which batches all 32 team profiles into ONE long crawl4ai
// render (budgeted up to 240s; PHA-944). A lone standings request with a single
// 45s shot queues BEHIND that batch and its window expires every hour, so the
// ingest falls back to the stale cache — exactly Brandon's "updated the first two
// days then stopped" / "is the hourly update running correctly?" symptom (the
// 0-3 / 3-0 red-strike LOGIC is correct, but it was reading frozen W-L data).
//
// Fix: give the standings crawl the same shape team-stats already has — a bounded
// retry over a total wall-clock budget, so a pass that loses the queue race lands
// on a later pass once crawl4ai drains. This runs deferred (off the render path),
// so a longer budget adds ZERO page latency. Constants + the pure pass-planner
// live here so the verify harness can prove the policy without a live crawl.

/** Per-attempt crawl timeout — generous enough to outlast a team-stats batch render. */
export const STANDINGS_CRAWL_PASS_TIMEOUT_MS = 90_000;
/** Max crawl attempts before giving up this tick (the next ~hourly read retries). */
export const STANDINGS_MAX_CRAWL_PASSES = 3;
/** Total wall-clock budget across all passes (caps the whole deferred ingest). */
export const STANDINGS_MAX_TOTAL_CRAWL_MS = 240_000;
/** Brief pause between a failed pass and the next, letting a contended crawl4ai drain. */
export const STANDINGS_RETRY_BACKOFF_MS = 5_000;

/**
 * Plan one crawl pass: the per-attempt timeout for `passIndex` (0-based), bounded
 * by the budget remaining after `elapsedMs`. Returns null when no passes or no
 * budget remain — the caller stops retrying. Pure, so verify can assert the
 * schedule (e.g. pass 0 gets the full per-pass timeout, the last pass is clamped
 * to the remaining budget, an exhausted budget yields null) without crawling.
 */
export function planStandingsCrawlPass(
  passIndex: number,
  elapsedMs: number,
): number | null {
  if (passIndex < 0 || passIndex >= STANDINGS_MAX_CRAWL_PASSES) return null;
  const remaining = STANDINGS_MAX_TOTAL_CRAWL_MS - elapsedMs;
  if (remaining <= 0) return null;
  return Math.min(STANDINGS_CRAWL_PASS_TIMEOUT_MS, remaining);
}
