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
    const wins = Number(stats[5]);
    const losses = Number(stats[6]);
    rows.push({
      seed: line.match(SEED_RE) ? Number(line.match(SEED_RE)![1]) : null,
      name: nameMatch[1].trim(),
      matches: Number(stats[1]),
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
