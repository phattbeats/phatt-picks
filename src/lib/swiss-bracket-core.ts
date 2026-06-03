/**
 * Live Swiss bracket (pure, PHA-902).
 *
 * Brandon wants the locked Swiss stage to look like a real tournament-site
 * bracket (cs.money / HLTV / BLAST): round columns (0:0 → 1:0 / 0:1 → 2:0 / 1:1
 * / 0:2 → …) where each cell is a match — both teams, the map score, the winner
 * highlighted — flowing into ADVANCING / ELIMINATED branches. The flat W-L table
 * is the summary; THIS is the picture.
 *
 * HLTV's event page renders that bracket and, crucially, embeds each cell's full
 * match data in a `data-match-details-popup-json` attribute (matchId, the two
 * teams + logos, the score + winner, best-of). crawl4ai gives us the rendered
 * HTML; this module is the pure seam that lifts those JSON blobs out, groups
 * them under their round label, and shapes them into bracket rounds. We map each
 * side's name back to a layout team so the logo cascade + "your pick" ring work.
 *
 * TRUTHFUL BY CONSTRUCTION: every score/winner/team is read straight from HLTV's
 * own match objects — we never infer a result. A cell we can't parse is dropped;
 * a side with no team yet is shown as TBD (that's what the source says).
 *
 * Pure leaf: no `@/`, no prisma, no fetch — imports only its sibling pure core
 * for the shared name-normalizer, so the verify harness loads it under node.
 */

import type { MatchableTeam } from "./swiss-results-core";

// Self-contained copy of the name normalizer (kept identical to swiss-results-
// core.normalizeTeamName). Pure leaf modules can't runtime-import a sibling —
// the verify harness loads them under node, where a relative import would need a
// file extension — so the shared rule is duplicated rather than imported. Fold
// generic org boilerplate, lowercase, strip non-alphanumerics: "Liquid" ~ "Team
// Liquid", "Sharks" ~ "Sharks Esports", "FlyQuest" ~ "Flyquest".
const BOILERPLATE = new Set(["team", "esports", "esport", "gaming", "club", "academy"]);
function normalizeTeamName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !BOILERPLATE.has(w))
    .join("");
}

/**
 * What's at stake in a round column, the way HLTV/cs.money label it:
 *   advancing  — winning here clinches a spot (a Bo3 whose winner reaches 3 wins)
 *   eliminated — losing here ends the run (a Bo3 whose loser reaches 3 losses)
 *   both       — both at once (the 2:2 decider: winner advances, loser is out)
 *   contention — an early progression match, neither outcome is terminal
 */
export type BracketRoundKind = "advancing" | "eliminated" | "both" | "contention";

/** One side of a match before layout matching (straight from HLTV). */
export interface RawBracketSide {
  /** Team name as HLTV prints it; null/"TBD" when the slot isn't filled yet. */
  name: string | null;
  hltvId: number | null;
  /** Map/series score for this side, or null when the match hasn't been played. */
  score: number | null;
  winner: boolean;
}

export interface RawBracketMatch {
  matchId: number | null;
  team1: RawBracketSide;
  team2: RawBracketSide;
  /** Maps in the series: 1 = Bo1, 3 = Bo3 (HLTV `numberOfMaps`). */
  bestOf: number;
  /** True once a result exists (a score / decided winner). */
  played: boolean;
  startTimeMs: number | null;
}

export interface RawSwissRound {
  /** HLTV round label, e.g. "0:0", "2:0", "0:2". */
  label: string;
  kind: BracketRoundKind;
  matches: RawBracketMatch[];
}

/** A side after matching to the committed layout (adds the pickid for logos). */
export interface BracketSide extends RawBracketSide {
  pickid: number | null;
}
export interface BracketMatch extends Omit<RawBracketMatch, "team1" | "team2"> {
  team1: BracketSide;
  team2: BracketSide;
}
export interface SwissRound extends Omit<RawSwissRound, "matches"> {
  matches: BracketMatch[];
}

/**
 * Classify a round column ("W:L") by what its matches DECIDE — matching how
 * HLTV/cs.money head the columns. A match in column W:L sends its winner to W+1
 * and its loser to L+1, so it's an ADVANCING match when the winner reaches the
 * advance threshold (W+1 ≥ advanceAt → e.g. 2:0, 2:1) and an ELIMINATED match
 * when the loser reaches the elimination threshold (L+1 ≥ eliminateAt → e.g.
 * 0:2, 1:2); the 2:2 decider is BOTH. Early progression matches (0:0, 1:0, 1:1)
 * are contention. Thresholds are parameterized for non-3-win Swiss formats. A
 * label we can't parse is contention (never falsely tells someone they're out).
 */
export function bracketRoundKind(
  label: string,
  advanceAt = 3,
  eliminateAt = 3,
): BracketRoundKind {
  const m = label.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return "contention";
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const decidesAdvance = wins + 1 >= advanceAt;
  const decidesElim = losses + 1 >= eliminateAt;
  if (decidesAdvance && decidesElim) return "both";
  if (decidesAdvance) return "advancing";
  if (decidesElim) return "eliminated";
  return "contention";
}

/** Shape of the bits we read out of HLTV's match-popup JSON (rest ignored). */
interface PopupJson {
  match?: { matchId?: number; status?: string; startTime?: number; numberOfMaps?: number };
  result?: { matchScore?: { team1Score?: number; team2Score?: number; team1Winner?: boolean } | null } | null;
  team1?: { team?: { id?: number; name?: string } };
  team2?: { team?: { id?: number; name?: string } };
}

function sideFrom(slot: PopupJson["team1"], score: number | null, winner: boolean): RawBracketSide {
  const team = slot?.team;
  return {
    name: team?.name ?? null,
    hltvId: typeof team?.id === "number" ? team.id : null,
    score,
    winner,
  };
}

function matchFromPopup(j: PopupJson): RawBracketMatch | null {
  const ms = j.result?.matchScore ?? null;
  const t1Score = ms && typeof ms.team1Score === "number" ? ms.team1Score : null;
  const t2Score = ms && typeof ms.team2Score === "number" ? ms.team2Score : null;
  const t1Win = !!ms?.team1Winner;
  // played once a real score exists (some scored 0; rely on a decided winner too).
  const played = ms != null && (t1Score !== null || t2Score !== null);
  const t2Win = played && !t1Win;
  return {
    matchId: typeof j.match?.matchId === "number" ? j.match.matchId : null,
    team1: sideFrom(j.team1, t1Score, t1Win && played),
    team2: sideFrom(j.team2, t2Score, t2Win),
    bestOf: typeof j.match?.numberOfMaps === "number" ? j.match.numberOfMaps : 1,
    played,
    startTimeMs: typeof j.match?.startTime === "number" ? j.match.startTime : null,
  };
}

// Decode the minimal HTML entities crawl4ai leaves in an attribute value.
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const TITLE_RE = /swiss-visual-matchups-title">\s*([^<]+?)\s*</g;
const POPUP_RE = /data-match-details-popup-json="([\s\S]*?)"/g;

/**
 * Parse HLTV's Swiss bracket out of the rendered event-page HTML. Walks the
 * round-title markers and the match-popup JSON blobs in document order, grouping
 * each match under the most recent round label. Returns rounds with at least one
 * parseable match, in source order (which is already the natural 0:0 → … flow).
 * Never throws: malformed JSON for a cell is skipped; no bracket at all → [].
 */
export function parseSwissBracket(
  html: string,
  opts: { advanceAt?: number; eliminateAt?: number } = {},
): RawSwissRound[] {
  // Collect (position, label) for titles and (position, json) for matches, then
  // assign each match to the nearest preceding title.
  const titles: { pos: number; label: string }[] = [];
  for (const m of html.matchAll(TITLE_RE)) {
    const label = m[1].trim();
    if (label) titles.push({ pos: m.index ?? 0, label });
  }
  if (titles.length === 0) return [];

  const byLabel = new Map<string, RawBracketMatch[]>();
  const order: string[] = [];
  for (const m of html.matchAll(POPUP_RE)) {
    const pos = m.index ?? 0;
    // nearest preceding title
    let label = titles[0].label;
    for (const t of titles) {
      if (t.pos <= pos) label = t.label;
      else break;
    }
    let parsed: RawBracketMatch | null = null;
    try {
      parsed = matchFromPopup(JSON.parse(decodeEntities(m[1])) as PopupJson);
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(parsed);
  }

  return order.map((label) => ({
    label,
    kind: bracketRoundKind(label, opts.advanceAt, opts.eliminateAt),
    matches: byLabel.get(label)!,
  }));
}

/** Attach a layout pickid to a side by normalized-name match. */
function matchSide(side: RawBracketSide, byNorm: Map<string, number>): BracketSide {
  const pickid = side.name ? byNorm.get(normalizeTeamName(side.name)) ?? null : null;
  return { ...side, pickid };
}

/**
 * Map every side in the bracket to a layout team (for logos + the "your pick"
 * ring). Names HLTV spells differently from our layout are folded by the shared
 * normalizer. Order preserved.
 */
export function matchBracketToLayout(
  rounds: readonly RawSwissRound[],
  teams: readonly MatchableTeam[],
): SwissRound[] {
  const byNorm = new Map<string, number>();
  for (const t of teams) {
    const key = normalizeTeamName(t.name);
    if (key && !byNorm.has(key)) byNorm.set(key, t.pickid);
  }
  return rounds.map((r) => ({
    label: r.label,
    kind: r.kind,
    matches: r.matches.map((mt) => ({
      ...mt,
      team1: matchSide(mt.team1, byNorm),
      team2: matchSide(mt.team2, byNorm),
    })),
  }));
}

/** Count played vs scheduled across the whole bracket (for header copy / hiding). */
export function bracketSummary(rounds: readonly SwissRound[]): {
  rounds: number;
  matches: number;
  played: number;
} {
  let matches = 0;
  let played = 0;
  for (const r of rounds) {
    for (const mt of r.matches) {
      matches++;
      if (mt.played) played++;
    }
  }
  return { rounds: rounds.length, matches, played };
}
