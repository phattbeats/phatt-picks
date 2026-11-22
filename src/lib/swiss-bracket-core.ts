/**
 * Live Swiss bracket (pure, #902).
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

import { teamNameIndex, type MatchableTeam } from "./swiss-results-core";

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
 * A column's standing, by the RECORD it represents — the same 3:0 / 0:3 buckets
 * the rest of the app uses (#898's "3:0 ADVANCED" / "0:3 ELIMINATED", the W-L
 * table's status):
 *   advancing  — a 3-win record (3:0 / 3:1 / 3:2): these teams are THROUGH
 *   eliminated — a 3-loss record (0:3 / 1:3 / 2:3): these teams are OUT
 *   contention — still playing (0:0 … 2:2): NOT yet advanced or eliminated
 * Brandon: advancing/eliminated is 3-0 and 0-3, NOT the 2-0 / 0-2 deciding match.
 */
export type BracketRoundKind = "advancing" | "eliminated" | "contention";

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

/** A team sitting in a terminal column (advanced / eliminated), pre layout match. */
export interface RawBracketTeam {
  name: string;
  hltvId: number | null;
}

export interface RawSwissRound {
  /** HLTV round label, e.g. "0:0", "2:0", "0:2", "3:0", "0:3". */
  label: string;
  kind: BracketRoundKind;
  /** Match cells — present on contention columns (the rounds still being played). */
  matches: RawBracketMatch[];
  /** Settled teams — present on terminal columns (3:0 advanced / 0:3 eliminated). */
  teams: RawBracketTeam[];
}

/** A side after matching to the committed layout (adds the pickid for logos). */
export interface BracketSide extends RawBracketSide {
  pickid: number | null;
}
export interface BracketTeam extends RawBracketTeam {
  pickid: number | null;
}
export interface BracketMatch extends Omit<RawBracketMatch, "team1" | "team2"> {
  team1: BracketSide;
  team2: BracketSide;
}
export interface SwissRound extends Omit<RawSwissRound, "matches" | "teams"> {
  matches: BracketMatch[];
  teams: BracketTeam[];
}

/**
 * Classify a round column ("W:L") by its RECORD: a 3-win record advances (3:0 /
 * 3:1 / 3:2), a 3-loss record is eliminated (0:3 / 1:3 / 2:3), everything else
 * (0:0 … 2:2) is still in contention. This matches the rest of the app — a team
 * is "advanced" only once it actually has 3 wins, not while it's a 2-0 still
 * playing its deciding Bo3. Thresholds are parameterized for non-3-win Swiss
 * formats. A label we can't parse is contention (never falsely says "out").
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
  if (wins >= advanceAt) return "advancing";
  if (losses >= eliminateAt) return "eliminated";
  return "contention";
}

/**
 * Shape of the bits we read out of HLTV's match-popup JSON (rest ignored).
 * Two generations: the original inline blob (match/result/team1/team2), and the
 * lazy reference HLTV switched to by Nov 2026 (PHA-5358), which carries only
 * `ref.matchId.matchId` and leaves teams, winner and score to the cell markup
 * and the group table.
 */
interface PopupJson {
  match?: { matchId?: number; status?: string; startTime?: number; numberOfMaps?: number };
  result?: { matchScore?: { team1Score?: number; team2Score?: number; team1Winner?: boolean } | null } | null;
  team1?: { team?: { id?: number; name?: string } };
  team2?: { team?: { id?: number; name?: string } };
  ref?: { matchId?: { matchId?: number } | null; resultId?: { resultId?: number } | null } | null;
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
// Terminal columns (3:0 advanced / 0:3 eliminated) list settled teams in a
// `swiss-matchups-team-wrapper`; each team is an <img class="swiss-visual-team-
// logo" ... title="TeamName">. Unfilled slots are `title="?"` placeholders.
// Match-cell logos use the same class but live in a `swiss-visual-matchups-
// wrapper`, so we scope each team-wrapper to [start, next wrapper marker) and
// only read titles inside it — never double-counting the still-playing teams.
const TEAM_WRAPPER_RE = /swiss-matchups-team-wrapper"/g;
const WRAPPER_BOUNDARY_RE = /swiss-(?:matchups-team-wrapper|visual-matchups-wrapper)"/g;
// A team with separate day/night art carries two logos ("… day-only" /
// "… night-only"); both match, and the wrapper loop de-duplicates by name.
const TEAM_TITLE_RE = /swiss-visual-team-logo(?:\s[^"]*)?"[^>]*\btitle="([^"]*)"/g;

// Lazy-ref cells (PHA-5358): each side is `<div class="swiss-visual-team
// [swiss-visual-match-winner|swiss-visual-match-loser]"><img … title="Name">`.
const CELL_TEAM_RE = /class="swiss-visual-team((?:\s[^"]*)?)"[^>]*>\s*<img\b[^>]*\btitle="([^"]*)"/g;
// The group table lists every match twice (once under each team's row) as
// `<a href="/matches/<id>/…" class="bottom-row">…data-unix="<ms>"…</a>`, with
// `score-left` / `score-right` once played (left = that row's team-1).
const BOTTOM_ROW_RE = /<a href="\/matches\/(\d+)\/[^"]*" class="bottom-row">([\s\S]*?)<\/a>/g;
const ROW_TEAM_RE = /class="group-team team-([12])[^"]*">\s*(?:<span[^>]*>([^<]*)<\/span>|[\s\S]*?<span class="text-ellipsis">([^<]*)<\/span>)/g;
const ROW_UNIX_RE = /data-unix="(\d+)"/;
const ROW_SCORE_RE = /score-left[^"]*">\s*(\d+)\s*<\/div>[\s\S]*?score-right[^"]*">\s*(\d+)\s*</;
const ROW_BEST_OF_RE = /group-right">\s*bo(\d)/i;

/** What the group table says about one match id. */
interface RowFacts {
  startTimeMs: number | null;
  bestOf: number | null;
  /** normalized team name -> series score, once played. */
  scoreByTeam: Map<string, number>;
}

/** Index the group table's bottom rows by HLTV match id. */
function indexBottomRows(html: string): Map<number, RowFacts> {
  const out = new Map<number, RowFacts>();
  for (const m of html.matchAll(BOTTOM_ROW_RE)) {
    const id = Number(m[1]);
    const body = m[2];
    const facts = out.get(id) ?? { startTimeMs: null, bestOf: null, scoreByTeam: new Map<string, number>() };
    const unix = body.match(ROW_UNIX_RE);
    if (unix && facts.startTimeMs === null) facts.startTimeMs = Number(unix[1]);
    const bo = body.match(ROW_BEST_OF_RE);
    if (bo && facts.bestOf === null) facts.bestOf = Number(bo[1]);
    const score = body.match(ROW_SCORE_RE);
    if (score) {
      const names: Record<string, string> = {};
      for (const t of body.matchAll(ROW_TEAM_RE)) names[t[1]] = decodeEntities((t[2] ?? t[3] ?? "").trim());
      if (names["1"]) facts.scoreByTeam.set(normalizeTeamName(names["1"]), Number(score[1]));
      if (names["2"]) facts.scoreByTeam.set(normalizeTeamName(names["2"]), Number(score[2]));
    }
    out.set(id, facts);
  }
  return out;
}

/**
 * Build a match from a lazy-ref cell: the two sides come from the cell's logo
 * titles and win/loss classes, the start time and score from the group table.
 * "?" / empty titles are unfilled slots (null name). Played = a side carries
 * the winner class.
 */
function matchFromRefCell(
  matchId: number | null,
  cellHtml: string,
  rows: Map<number, RowFacts>,
): RawBracketMatch {
  const sides: { name: string | null; winner: boolean; decided: boolean }[] = [];
  for (const t of cellHtml.matchAll(CELL_TEAM_RE)) {
    const cls = t[1];
    const name = decodeEntities(t[2]).trim();
    sides.push({
      name: name && name !== "?" && name.toUpperCase() !== "TBD" ? name : null,
      winner: /swiss-visual-match-winner/.test(cls),
      decided: /swiss-visual-match-(?:winner|loser)/.test(cls),
    });
    if (sides.length === 2) break;
  }
  while (sides.length < 2) sides.push({ name: null, winner: false, decided: false });
  const facts = matchId !== null ? rows.get(matchId) : undefined;
  const played = sides.some((s) => s.decided);
  const scoreOf = (name: string | null): number | null => {
    if (!played || !name || !facts) return null;
    return facts.scoreByTeam.get(normalizeTeamName(name)) ?? null;
  };
  const side = (s: (typeof sides)[number]): RawBracketSide => ({
    name: s.name,
    hltvId: null,
    score: scoreOf(s.name),
    winner: played && s.winner,
  });
  return {
    matchId,
    team1: side(sides[0]),
    team2: side(sides[1]),
    bestOf: facts?.bestOf ?? 1,
    played,
    startTimeMs: facts?.startTimeMs ?? null,
  };
}

/** Nearest preceding round label for a document position. */
function labelAt(pos: number, titles: { pos: number; label: string }[]): string {
  let label = titles[0].label;
  for (const t of titles) {
    if (t.pos <= pos) label = t.label;
    else break;
  }
  return label;
}

/**
 * Parse HLTV's Swiss bracket out of the rendered event-page HTML. Walks the
 * round-title markers and, per round, the match-popup JSON blobs (contention
 * columns still being played) AND the settled teams in terminal columns (3:0
 * advanced / 0:3 eliminated). Each cell is grouped under its nearest preceding
 * round label, in source order (the natural 0:0 → … 3:0 / 0:3 flow). Returns
 * only rounds that have at least one match or one real (non-placeholder) team.
 * Never throws: malformed JSON for a cell is skipped; no bracket at all → [].
 */
export function parseSwissBracket(
  html: string,
  opts: { advanceAt?: number; eliminateAt?: number } = {},
): RawSwissRound[] {
  const titles: { pos: number; label: string }[] = [];
  for (const m of html.matchAll(TITLE_RE)) {
    const label = m[1].trim();
    if (label) titles.push({ pos: m.index ?? 0, label });
  }
  if (titles.length === 0) return [];

  const matchesByLabel = new Map<string, RawBracketMatch[]>();
  const teamsByLabel = new Map<string, RawBracketTeam[]>();
  const order: string[] = [];
  const see = (label: string) => {
    if (!matchesByLabel.has(label)) {
      matchesByLabel.set(label, []);
      teamsByLabel.set(label, []);
      order.push(label);
    }
  };

  // 1. Match cells (contention columns). A lazy-ref popup (PHA-5358) carries
  // no teams, so read them from the cell's own markup (up to the next cell or
  // column marker) and the group table's rows.
  const popups = [...html.matchAll(POPUP_RE)];
  let rows: Map<number, RowFacts> | null = null;
  for (const [i, m] of popups.entries()) {
    let parsed: RawBracketMatch | null = null;
    try {
      const j = JSON.parse(decodeEntities(m[1])) as PopupJson;
      if (j.ref && !j.team1 && !j.team2) {
        rows ??= indexBottomRows(html);
        const start = (m.index ?? 0) + m[0].length;
        const nextCell = popups[i + 1]?.index ?? html.length;
        const nextTitle = html.indexOf("swiss-visual-matchups-title", start);
        const end = Math.min(nextCell, nextTitle === -1 ? html.length : nextTitle);
        const id = j.ref.matchId?.matchId;
        parsed = matchFromRefCell(typeof id === "number" ? id : null, html.slice(start, end), rows);
      } else {
        parsed = matchFromPopup(j);
      }
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    const label = labelAt(m.index ?? 0, titles);
    see(label);
    matchesByLabel.get(label)!.push(parsed);
  }

  // 2. Settled teams in terminal columns (advanced / eliminated). Each wrapper
  // owns the team titles from its start up to the next wrapper marker.
  //
  // #936: a wrapper's label is NOT simply the nearest preceding title. HLTV
  // stacks the two terminal boxes of a deciding column (e.g. 3:1 over 3:2, or
  // 1:3 over 2:3) by emitting BOTH titles consecutively and THEN both team
  // wrappers, in the same order. Nearest-preceding-title collapses both wrappers
  // onto the LATER title (3:2), leaving the yesterday-decided box (3:1) wrongly
  // empty and dumping its teams into the not-yet-played box. So pair terminal
  // titles to wrappers POSITIONALLY: each wrapper, in source order, claims the
  // next unconsumed terminal title that precedes it (FIFO). Non-terminal
  // (contention) titles carry match cells, never team wrappers, so they're not
  // in the queue. Falls back to labelAt if the queue is exhausted (defensive).
  const terminalTitles = titles.filter(
    (t) => bracketRoundKind(t.label, opts.advanceAt, opts.eliminateAt) !== "contention",
  );
  let ti = 0;
  const boundaries = [...html.matchAll(WRAPPER_BOUNDARY_RE)].map((m) => m.index ?? 0);
  for (const w of html.matchAll(TEAM_WRAPPER_RE)) {
    const start = w.index ?? 0;
    const end = boundaries.find((b) => b > start) ?? html.length;
    let label: string;
    if (ti < terminalTitles.length && terminalTitles[ti].pos <= start) {
      label = terminalTitles[ti].label;
      ti++; // consume even when the wrapper is all placeholders, to stay aligned
    } else {
      label = labelAt(start, titles);
    }
    const seenNames = new Set<string>();
    for (const t of html.slice(start, end).matchAll(TEAM_TITLE_RE)) {
      const name = decodeEntities(t[1]).trim();
      if (!name || name === "?") continue; // unfilled placeholder slot
      if (seenNames.has(name)) continue; // day/night twin of the same logo
      seenNames.add(name);
      see(label);
      teamsByLabel.get(label)!.push({ name, hltvId: null });
    }
  }

  return order.map((label) => ({
    label,
    kind: bracketRoundKind(label, opts.advanceAt, opts.eliminateAt),
    matches: matchesByLabel.get(label)!,
    teams: teamsByLabel.get(label)!,
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
  const byNorm = teamNameIndex(teams, normalizeTeamName);
  return rounds.map((r) => ({
    label: r.label,
    kind: r.kind,
    matches: r.matches.map((mt) => ({
      ...mt,
      team1: matchSide(mt.team1, byNorm),
      team2: matchSide(mt.team2, byNorm),
    })),
    teams: r.teams.map((t) => ({
      ...t,
      pickid: byNorm.get(normalizeTeamName(t.name)) ?? null,
    })),
  }));
}

/**
 * Derive per-team clinched W-L records from the bracket's TERMINAL columns
 * (#1044). Each terminal round's label IS the record of every settled team
 * listed in it: "3:0" → 3-0, "3:1" → 3-1, "0:3" → 0-3, etc. This is the fallback
 * source for outcome bridging when HLTV reformats the W-L *table* header (so
 * `parseHltvSwissStandings` yields nothing) but the *bracket* still parses — the
 * leaderboard then keeps resolving Swiss clinches off the bracket instead of
 * silently freezing (the #918/951 "scoring stalled for two days" symptom).
 *
 * Only terminal (advancing/eliminated) rounds carry settled teams; contention
 * columns are skipped. Only sides matched to a layout pickid are returned (an
 * unmatched name can't be bridged to an outcome). The exact label record is
 * preserved so the downstream clinch logic buckets 3:0 vs 3:1/3:2 vs 0:3
 * correctly. Pure — verify covers it offline.
 */
export function bracketTerminalRecords(
  rounds: readonly SwissRound[],
): Array<{ pickid: number; wins: number; losses: number }> {
  const out: Array<{ pickid: number; wins: number; losses: number }> = [];
  for (const r of rounds) {
    if (r.kind === "contention") continue;
    const m = r.label.match(/(\d+)\s*:\s*(\d+)/);
    if (!m) continue;
    const wins = Number(m[1]);
    const losses = Number(m[2]);
    for (const t of r.teams) {
      if (t.pickid != null) out.push({ pickid: t.pickid, wins, losses });
    }
  }
  return out;
}

/**
 * Tally each team's Swiss series W-L straight from the bracket's MATCH cells
 * (#1109). Every played match carries both sides and the decided winner, all
 * read from HLTV's server-rendered popup-json — so this resolves records even
 * when the JS standings *table* never renders into the crawl (parseHltvSwissStandings
 * yields 0 rows) AND the terminal-column lists don't parse (bracketTerminalRecords
 * yields 0). That is exactly the post-stage hub state that left a 0:3 elimination
 * (B8) un-green and unscored: the only crawlable terminal-record source was this
 * one, and the bridge wasn't reading it.
 *
 * Keyed by layout pickid; a side with no pickid (unmatched name / TBD slot) is
 * skipped. Deduped by matchId so a match surfacing in more than one round can't
 * double-count a series. Counts SERIES results (one win/loss per match), which is
 * the Swiss record — not map scores. Pure; verify covers it offline.
 */
export function bracketMatchRecords(
  rounds: readonly SwissRound[],
): Array<{ pickid: number; wins: number; losses: number }> {
  const rec = new Map<number, { wins: number; losses: number }>();
  const seen = new Set<number>();
  const bump = (pickid: number, w: number, l: number) => {
    const r = rec.get(pickid) ?? { wins: 0, losses: 0 };
    r.wins += w;
    r.losses += l;
    rec.set(pickid, r);
  };
  for (const round of rounds) {
    for (const m of round.matches) {
      if (!m.played) continue;
      if (m.matchId != null) {
        if (seen.has(m.matchId)) continue; // same series can appear in >1 column
        seen.add(m.matchId);
      }
      const { team1: a, team2: b } = m;
      if (a.winner === b.winner) continue; // undecided / malformed — no result to bank
      const winner = a.winner ? a : b;
      const loser = a.winner ? b : a;
      if (winner.pickid != null) bump(winner.pickid, 1, 0);
      if (loser.pickid != null) bump(loser.pickid, 0, 1);
    }
  }
  return [...rec.entries()].map(([pickid, r]) => ({ pickid, ...r }));
}

/** Count played/scheduled matches + settled teams across the bracket. */
export function bracketSummary(rounds: readonly SwissRound[]): {
  rounds: number;
  matches: number;
  played: number;
  advanced: number;
  eliminated: number;
} {
  let matches = 0;
  let played = 0;
  let advanced = 0;
  let eliminated = 0;
  for (const r of rounds) {
    for (const mt of r.matches) {
      matches++;
      if (mt.played) played++;
    }
    if (r.kind === "advancing") advanced += r.teams.length;
    if (r.kind === "eliminated") eliminated += r.teams.length;
  }
  return { rounds: rounds.length, matches, played, advanced, eliminated };
}
