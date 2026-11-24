/**
 * HOTLINE Fantasy (pure, PHA-5454) — the rules of the fantasy game.
 *
 * Modelled on BLAST.tv's CS fantasy rulebook: each stage you field five
 * players, one from each tier, at most two from one team, with one captain.
 * Every finished match ranks its ten players by HLTV rating and pays 100 down
 * to 10; a win adds 10; a 3-0 Swiss run adds 100 for each player of that team.
 * The captain's points are multiplied by tier (1.2x Diamond up to 2.0x Bronze).
 * On top, each of your five carries one role card worth a bonus when hit.
 *
 * A lineup scores only matches that START after it was saved (BLAST's
 * late-join rule). That one rule replaces a hard lock: before the stage starts
 * you edit freely and everything counts; after it starts you can still join,
 * once, and you score from then on.
 *
 * This module is the pure seam: tiering, lineup validation, the HLTV match and
 * results page parsers, and all scoring. No `@/`, no prisma, no fetch, so
 * scripts/verify-fantasy.ts loads it under plain node. The crawl and the DB
 * live in fantasy.ts.
 *
 * TRUTHFUL BY CONSTRUCTION: every kill, rating and result is read from HLTV's
 * own match page. A match we cannot fully parse scores nothing until it can be.
 */

/* ── Tiers, roles, point values ───────────────────────────────────────── */

export const TIERS = ["diamond", "platinum", "gold", "silver", "bronze"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  diamond: "Diamond",
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};

/** Captain multiplier by the captain's tier (BLAST rulebook). */
export const CAPTAIN_MULTIPLIER: Readonly<Record<Tier, number>> = {
  diamond: 1.2,
  platinum: 1.4,
  gold: 1.6,
  silver: 1.8,
  bronze: 2.0,
};

/** Points for a player's rank among the ten players of a match, best first. */
export const PLACEMENT_POINTS: readonly number[] = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
export const WIN_POINTS = 10;
/** Each player of a team that goes 3-0 in a Swiss stage. */
export const SWISS_PERFECT_BONUS = 100;
export const ROLE_BONUS = 25;
export const LINEUP_SIZE = 5;
export const MAX_PER_TEAM = 2;

export const ROLES = ["fragger", "survivor", "hitter", "glue", "star"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Readonly<Record<Role, { label: string; rule: string }>> = {
  fragger: { label: "Fragger", rule: "Most kills on his team in the match" },
  survivor: { label: "Survivor", rule: "Fewest deaths on his team in the match" },
  hitter: { label: "Heavy Hitter", rule: "85 or more damage per round" },
  glue: { label: "Glue", rule: "KAST of 74% or higher" },
  star: { label: "Star", rule: "Top three rating in the match" },
};

export const HITTER_MIN_ADR = 85;
export const GLUE_MIN_KAST = 74;
export const STAR_MAX_PLACEMENT = 3;

/* ── Stages ───────────────────────────────────────────────────────────── */

export type FantasyStageKind = "swiss" | "playoff";

/** One fantasy stage: a Swiss stage, or the whole playoff bracket as one. */
export interface FantasyStage {
  /** The Swiss section id, or the first playoff section id for the bracket. */
  id: number;
  name: string;
  short: string;
  kind: FantasyStageKind;
  /** Pick'Em sections this stage covers (one for Swiss, QF/SF/GF for playoffs). */
  sectionIds: number[];
  /** How many teams play the stage. */
  fieldSize: number;
}

const ROMAN = ["I", "II", "III", "IV", "V"];

/**
 * An event's fantasy stages from its sections in play order: every Swiss
 * section is a stage, and all playoff sections fold into one "Playoffs" stage.
 */
export function fantasyStagesFor(
  sections: readonly { sectionId: number; name: string; kind: "swiss" | "playoff" }[],
): FantasyStage[] {
  const stages: FantasyStage[] = [];
  let swissIdx = 0;
  const playoff = sections.filter((s) => s.kind === "playoff").map((s) => s.sectionId);
  for (const s of sections) {
    if (s.kind !== "swiss") continue;
    stages.push({
      id: s.sectionId,
      name: s.name,
      short: `Stage ${ROMAN[swissIdx] ?? swissIdx + 1}`,
      kind: "swiss",
      sectionIds: [s.sectionId],
      fieldSize: 16,
    });
    swissIdx++;
  }
  if (playoff.length > 0) {
    stages.push({
      id: Math.min(...playoff),
      name: "Playoffs",
      short: "Playoffs",
      kind: "playoff",
      sectionIds: [...playoff].sort((a, b) => a - b),
      fieldSize: 8,
    });
  }
  return stages;
}

/* ── Player pool ──────────────────────────────────────────────────────── */

/** A team as the pool builder needs it (from the layout + roster snapshot). */
export interface PoolTeamInput {
  pickid: number;
  name: string;
  hltvTeamId: number | null;
  worldRank: number | null;
  roster: readonly {
    name: string;
    position: string;
    rating: number | null;
    hltvUrl: string;
    photo?: string;
    country?: { code: string; name: string; flag: string | null } | null;
    standIn?: boolean;
  }[];
}

export interface FantasyPlayer {
  /** HLTV player id: the join key between the roster and a match page. */
  id: number;
  name: string;
  teamPickid: number;
  teamName: string;
  hltvTeamId: number | null;
  position: string;
  rating: number | null;
  photo: string | null;
  flag: string | null;
  country: string | null;
  standIn: boolean;
  tier: Tier;
}

/** The HLTV player id inside a `/player/<id>/<slug>` url, or null. */
export function hltvPlayerIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/player\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * Build a stage's player pool and cut it into five equal tiers by HLTV rating.
 * Order: rating high to low (unrated last), then the better-ranked team, then
 * name, so the cut is stable. A player with no HLTV id cannot be scored and is
 * left out.
 */
export function buildPool(teams: readonly PoolTeamInput[]): FantasyPlayer[] {
  const flat: Omit<FantasyPlayer, "tier">[] = [];
  const seen = new Set<number>();
  for (const t of teams) {
    for (const p of t.roster) {
      const id = hltvPlayerIdFromUrl(p.hltvUrl);
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      flat.push({
        id,
        name: p.name,
        teamPickid: t.pickid,
        teamName: t.name,
        hltvTeamId: t.hltvTeamId,
        position: p.position,
        rating: p.rating,
        photo: p.photo ?? null,
        flag: p.country?.flag ?? null,
        country: p.country?.name ?? null,
        standIn: p.standIn === true,
      });
    }
  }
  const rankOf = new Map(teams.map((t) => [t.pickid, t.worldRank ?? 9999]));
  flat.sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      (rankOf.get(a.teamPickid) ?? 9999) - (rankOf.get(b.teamPickid) ?? 9999) ||
      a.name.localeCompare(b.name) ||
      a.id - b.id,
  );
  const n = flat.length;
  return flat.map((p, i) => ({
    ...p,
    tier: TIERS[Math.min(TIERS.length - 1, Math.floor((i * TIERS.length) / Math.max(n, 1)))],
  }));
}

/* ── Lineups ──────────────────────────────────────────────────────────── */

export interface LineupSlot {
  playerId: number;
  role: Role;
}

export interface Lineup {
  slots: LineupSlot[];
  captainId: number;
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Coerce untrusted JSON into a Lineup shape, or null when it is not one. */
export function parseLineup(raw: unknown): Lineup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { slots?: unknown; captainId?: unknown };
  if (!Array.isArray(o.slots)) return null;
  const slots: LineupSlot[] = [];
  for (const s of o.slots) {
    if (!s || typeof s !== "object") return null;
    const { playerId, role } = s as { playerId?: unknown; role?: unknown };
    const id = Number(playerId);
    if (!Number.isInteger(id) || id <= 0 || !isRole(role)) return null;
    slots.push({ playerId: id, role });
  }
  const captainId = Number(o.captainId);
  if (!Number.isInteger(captainId) || captainId <= 0) return null;
  return { slots, captainId };
}

/**
 * Why a lineup is not legal against a stage pool; empty when it is. Rules:
 * five players, all in the pool, one from each tier, at most two per team,
 * five different roles, and the captain is one of the five.
 */
export function validateLineup(lineup: Lineup, pool: readonly FantasyPlayer[]): string[] {
  const problems: string[] = [];
  const byId = new Map(pool.map((p) => [p.id, p]));
  if (lineup.slots.length !== LINEUP_SIZE) {
    problems.push(`A lineup is ${LINEUP_SIZE} players.`);
    return problems;
  }
  const ids = new Set(lineup.slots.map((s) => s.playerId));
  if (ids.size !== LINEUP_SIZE) problems.push("The same player is in the lineup twice.");
  const players: FantasyPlayer[] = [];
  for (const s of lineup.slots) {
    const p = byId.get(s.playerId);
    if (!p) {
      problems.push("A player in the lineup is not in this stage.");
      return problems;
    }
    players.push(p);
  }
  for (const tier of TIERS) {
    const n = players.filter((p) => p.tier === tier).length;
    if (n !== 1) problems.push(`Pick exactly one ${TIER_LABEL[tier]} player.`);
  }
  const perTeam = new Map<number, number>();
  for (const p of players) perTeam.set(p.teamPickid, (perTeam.get(p.teamPickid) ?? 0) + 1);
  for (const [pickid, n] of perTeam) {
    if (n > MAX_PER_TEAM) {
      const name = players.find((p) => p.teamPickid === pickid)?.teamName ?? "one team";
      problems.push(`At most ${MAX_PER_TEAM} players from ${name}.`);
    }
  }
  if (new Set(lineup.slots.map((s) => s.role)).size !== LINEUP_SIZE) {
    problems.push("Give each player a different role.");
  }
  if (!ids.has(lineup.captainId)) problems.push("The captain must be one of your five.");
  return problems;
}

/** A fantasy team name: trimmed, single-spaced, printable, at most 28 chars. */
export function cleanTeamName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

/* ── HLTV parsing ─────────────────────────────────────────────────────── */

export interface MatchPlayerLine {
  /** HLTV player id. */
  id: number;
  nick: string;
  hltvTeamId: number;
  kills: number;
  deaths: number;
  adr: number;
  /** KAST percentage, 0-100. */
  kast: number;
  rating: number;
}

export interface MatchSide {
  hltvTeamId: number;
  name: string;
  /** Maps won (Bo3/Bo5) or rounds won (Bo1), as HLTV prints the headline score. */
  score: number;
}

export interface FantasyMatchData {
  hltvMatchId: number;
  startMs: number;
  bestOf: number;
  team1: MatchSide;
  team2: MatchSide;
  /** Null only for a drawn headline score, which a Major never produces. */
  winnerHltvTeamId: number | null;
  /** HLTV's info line, e.g. "Best of 3 (LAN) * Quarter-final". */
  info: string;
  /** The match page path as HLTV links it (kept for the correction re-read). */
  path?: string;
  players: MatchPlayerLine[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** One side of the match header: `teamN-gradient` holds the team link + score. */
function parseSide(html: string, n: 1 | 2): MatchSide | null {
  const at = html.indexOf(`class="team${n}-gradient"`);
  if (at < 0) return null;
  const block = html.slice(at, at + 2500);
  const team = block.match(/href="\/team\/(\d+)\/[^"]*"/);
  const name = block.match(/<div class="teamName">([^<]*)<\/div>/);
  const score = block.match(/<div class="(?:won|lost|tie)">(\d+)<\/div>/);
  if (!team || !name || !score) return null;
  return { hltvTeamId: Number(team[1]), name: decodeEntities(name[1]).trim(), score: Number(score[1]) };
}

/**
 * Parse a finished HLTV match page. Returns null when the match is not over or
 * its all-maps stats table is not complete yet (HLTV fills it a few minutes
 * after the final round), so the caller simply tries again later.
 *
 * Reads: the two header sides (team id, name, headline score), the scheduled
 * start (`data-unix`), the info line, and the `all-content` stats block: one
 * `totalstats` table per team, one row per player with K-D, ADR, KAST and
 * Rating. Only the plain columns are read, never the eco-adjusted ones.
 */
export function parseHltvMatchPage(html: string, hltvMatchId: number): FantasyMatchData | null {
  if (!/<div class="countdown">\s*Match over\s*<\/div>/.test(html)) return null;
  const team1 = parseSide(html, 1);
  const team2 = parseSide(html, 2);
  if (!team1 || !team2) return null;

  const unix = html.match(/class="time"[^>]*data-unix="(\d+)"/) ?? html.match(/data-unix="(\d{12,})"/);
  if (!unix) return null;
  const startMs = Number(unix[1]);

  const infoAt = html.indexOf("preformatted-text");
  const infoRaw = infoAt >= 0 ? html.slice(html.indexOf(">", infoAt) + 1, html.indexOf("</div>", infoAt)) : "";
  const info = stripTags(infoRaw);
  const bo = info.match(/Best of (\d)/i);
  const bestOf = bo ? Number(bo[1]) : Math.max(1, team1.score + team2.score > 3 ? 1 : team1.score + team2.score);

  const allAt = html.indexOf('id="all-content"');
  if (allAt < 0) return null;
  const next = html.slice(allAt + 10).search(/<div class="stats-content" id="/);
  const all = next >= 0 ? html.slice(allAt, allAt + 10 + next) : html.slice(allAt);
  // Each team has a `totalstats` table followed by hidden per-side (CT / T)
  // tables; keep only the totals by cutting each chunk at its own </table>.
  const tables = all
    .split(/<table class="table totalstats">/)
    .slice(1)
    .map((t) => t.slice(0, Math.max(0, t.indexOf("</table>"))));
  if (tables.length < 2) return null;

  const players: MatchPlayerLine[] = [];
  for (const table of tables.slice(0, 2)) {
    const teamId = table.match(/href="\/team\/(\d+)\//);
    if (!teamId) return null;
    const rows = table.split(/<tr[^>]*>/).slice(1);
    for (const row of rows) {
      const pid = row.match(/href="\/player\/(\d+)\//);
      if (!pid) continue; // header row
      const nick = row.match(/class="player-nick">([^<]*)</);
      const kd = row.match(/class="kd text-center traditional-data">\s*(\d+)\s*-\s*(\d+)\s*</);
      const adr = row.match(/class="adr text-center traditional-data">\s*([\d.]+)\s*</);
      const kast = row.match(/class="kast text-center traditional-data">\s*([\d.]+)%\s*</);
      const rating = row.match(/class="rating text-center[^"]*">\s*([\d.]+)\s*</);
      if (!kd || !adr || !kast || !rating) return null; // stats not final yet
      players.push({
        id: Number(pid[1]),
        nick: decodeEntities(nick?.[1] ?? "").trim(),
        hltvTeamId: Number(teamId[1]),
        kills: Number(kd[1]),
        deaths: Number(kd[2]),
        adr: Number(adr[1]),
        kast: Number(kast[1]),
        rating: Number(rating[1]),
      });
    }
  }
  if (players.length < 10) return null;

  const winnerHltvTeamId =
    team1.score > team2.score ? team1.hltvTeamId : team2.score > team1.score ? team2.hltvTeamId : null;
  return { hltvMatchId, startMs, bestOf, team1, team2, winnerHltvTeamId, info, players };
}

export interface ResultLink {
  hltvMatchId: number;
  /** Path as HLTV links it, e.g. "/matches/2400494/heroic-vs-imperial-…". */
  path: string;
  /** When HLTV recorded the result (the match's end), ms; null if absent. */
  endedMs: number | null;
}

/**
 * The finished matches on an HLTV `results?event=<id>` page: every `result-con`
 * entry with its match link. Featured duplicates collapse on the match id.
 */
export function parseHltvResultsPage(html: string): ResultLink[] {
  const out = new Map<number, ResultLink>();
  const re = /<div class="result-con[^"]*"(?:\s+data-zonedgrouping-entry-unix="(\d+)")?[^>]*>\s*<a href="(\/matches\/(\d+)\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = Number(m[3]);
    if (!out.has(id)) out.set(id, { hltvMatchId: id, path: m[2], endedMs: m[1] ? Number(m[1]) : null });
  }
  return [...out.values()];
}

/**
 * True when a match's HLTV info line names a playoff round as the match's own
 * round ("* Quarter-final"). A Swiss line can mention the playoffs as where
 * the winner goes, so anything naming a Swiss round is never a playoff match.
 */
export function isPlayoffInfo(info: string): boolean {
  if (/swiss/i.test(info)) return false;
  return /(?:^|\*\s*)(?:quarter-?finals?|semi-?finals?|grand[ -]finals?|finals?)\b/i.test(info);
}

/* ── Scoring ──────────────────────────────────────────────────────────── */

export interface PlayerMatchScore {
  playerId: number;
  hltvMatchId: number;
  hltvTeamId: number;
  opponent: string;
  startMs: number;
  /** 1-based rank among the match's players by rating. */
  placement: number;
  placementPoints: number;
  won: boolean;
  winPoints: number;
  kills: number;
  deaths: number;
  adr: number;
  kast: number;
  rating: number;
  /** Which role cards this performance would have paid. */
  roleHits: Record<Role, boolean>;
}

/**
 * Score one finished match for every player in it. Placement is the rank by
 * rating, ties broken by kill difference, then ADR, then kills, then HLTV id
 * (so a tie never splits points and never depends on row order).
 */
export function scoreMatch(match: FantasyMatchData): PlayerMatchScore[] {
  const ranked = [...match.players].sort(
    (a, b) =>
      b.rating - a.rating ||
      b.kills - b.deaths - (a.kills - a.deaths) ||
      b.adr - a.adr ||
      b.kills - a.kills ||
      a.id - b.id,
  );
  const maxKills = new Map<number, number>();
  const minDeaths = new Map<number, number>();
  for (const p of match.players) {
    maxKills.set(p.hltvTeamId, Math.max(maxKills.get(p.hltvTeamId) ?? -1, p.kills));
    minDeaths.set(p.hltvTeamId, Math.min(minDeaths.get(p.hltvTeamId) ?? Infinity, p.deaths));
  }
  return ranked.map((p, i) => {
    const won = match.winnerHltvTeamId != null && p.hltvTeamId === match.winnerHltvTeamId;
    const opponent = p.hltvTeamId === match.team1.hltvTeamId ? match.team2.name : match.team1.name;
    return {
      playerId: p.id,
      hltvMatchId: match.hltvMatchId,
      hltvTeamId: p.hltvTeamId,
      opponent,
      startMs: match.startMs,
      placement: i + 1,
      placementPoints: PLACEMENT_POINTS[i] ?? 0,
      won,
      winPoints: won ? WIN_POINTS : 0,
      kills: p.kills,
      deaths: p.deaths,
      adr: p.adr,
      kast: p.kast,
      rating: p.rating,
      roleHits: {
        fragger: p.kills === maxKills.get(p.hltvTeamId),
        survivor: p.deaths === minDeaths.get(p.hltvTeamId),
        hitter: p.adr >= HITTER_MIN_ADR,
        glue: p.kast >= GLUE_MIN_KAST,
        star: i + 1 <= STAR_MAX_PLACEMENT,
      },
    };
  });
}

export interface TeamRecord {
  wins: number;
  losses: number;
  /** Start of the match that brought the third win, when there is one. */
  thirdWinStartMs: number | null;
}

/** Each team's win-loss record over a stage's finished matches, by HLTV team id. */
export function teamRecords(matches: readonly FantasyMatchData[]): Map<number, TeamRecord> {
  const rec = new Map<number, TeamRecord>();
  const get = (id: number): TeamRecord => {
    let r = rec.get(id);
    if (!r) rec.set(id, (r = { wins: 0, losses: 0, thirdWinStartMs: null }));
    return r;
  };
  for (const m of [...matches].sort((a, b) => a.startMs - b.startMs || a.hltvMatchId - b.hltvMatchId)) {
    if (m.winnerHltvTeamId == null) continue;
    for (const side of [m.team1, m.team2]) {
      const r = get(side.hltvTeamId);
      if (side.hltvTeamId === m.winnerHltvTeamId) {
        r.wins++;
        if (r.wins === 3 && r.thirdWinStartMs == null) r.thirdWinStartMs = m.startMs;
      } else r.losses++;
    }
  }
  return rec;
}

/** A Swiss team's standing from its record: three wins advance, three losses are out. */
export function swissStatus(r: TeamRecord | undefined): "advanced" | "eliminated" | "alive" {
  if (!r) return "alive";
  if (r.wins >= 3) return "advanced";
  if (r.losses >= 3) return "eliminated";
  return "alive";
}

/**
 * Has a stage been played out? Swiss: every one of its `fieldSize` teams has
 * three wins or three losses. Playoffs: `fieldSize - 1` matches are in (a
 * single-elimination bracket of eight is seven matches).
 */
export function isStageComplete(stage: FantasyStage, matches: readonly FantasyMatchData[]): boolean {
  if (stage.kind === "playoff") return matches.length >= stage.fieldSize - 1;
  const rec = teamRecords(matches);
  let decided = 0;
  for (const r of rec.values()) if (r.wins >= 3 || r.losses >= 3) decided++;
  return decided >= stage.fieldSize;
}

export interface ScoredMatchLine extends PlayerMatchScore {
  /** False when the match started before this lineup was saved. */
  counted: boolean;
  roleHit: boolean;
  rolePoints: number;
  /** placement + win + role for this match (0 when not counted). */
  points: number;
}

export interface ScoredPlayer {
  playerId: number;
  role: Role;
  captain: boolean;
  tier: Tier | null;
  multiplier: number;
  placementPoints: number;
  winPoints: number;
  rolePoints: number;
  perfectBonus: number;
  /** Everything above, before the captain multiplier. */
  base: number;
  /** Rounded total after the captain multiplier. */
  total: number;
  matches: ScoredMatchLine[];
}

export interface ScoredLineup {
  total: number;
  players: ScoredPlayer[];
  /** Matches that counted for at least one of the five. */
  matchesCounted: number;
}

export interface ScoreContext {
  stage: FantasyStage;
  /** When the stage starts scoring (ms), or null while unpublished. */
  stageStartMs: number | null;
  matches: readonly FantasyMatchData[];
  pool: readonly FantasyPlayer[];
}

/**
 * The instant from which a lineup scores: everything, when it was saved before
 * the stage started; otherwise only matches starting at or after the save.
 */
export function lineupCountsFromMs(lockedAtMs: number, stageStartMs: number | null): number {
  if (stageStartMs == null || lockedAtMs <= stageStartMs) return -Infinity;
  return lockedAtMs;
}

/**
 * Score a lineup over a stage. Per player: placement + win + role-card points
 * for every counted match, plus the 3-0 bonus when the team's clinching third
 * straight win also counted, all times the captain multiplier for the captain.
 */
export function scoreLineup(lineup: Lineup, lockedAtMs: number, ctx: ScoreContext): ScoredLineup {
  const fromMs = lineupCountsFromMs(lockedAtMs, ctx.stageStartMs);
  const startFloor = ctx.stageStartMs ?? -Infinity;
  const byId = new Map(ctx.pool.map((p) => [p.id, p]));
  const lines = new Map<number, PlayerMatchScore[]>();
  for (const m of ctx.matches) {
    for (const s of scoreMatch(m)) {
      const arr = lines.get(s.playerId) ?? [];
      arr.push(s);
      lines.set(s.playerId, arr);
    }
  }
  const records = ctx.stage.kind === "swiss" ? teamRecords(ctx.matches) : new Map<number, TeamRecord>();
  const countedMatchIds = new Set<number>();

  const players: ScoredPlayer[] = lineup.slots.map((slot) => {
    const p = byId.get(slot.playerId);
    const captain = slot.playerId === lineup.captainId;
    const multiplier = captain && p ? CAPTAIN_MULTIPLIER[p.tier] : 1;
    const matches: ScoredMatchLine[] = (lines.get(slot.playerId) ?? [])
      .sort((a, b) => a.startMs - b.startMs || a.hltvMatchId - b.hltvMatchId)
      .map((s) => {
        const counted = s.startMs >= fromMs && s.startMs >= startFloor;
        const roleHit = s.roleHits[slot.role];
        const rolePoints = counted && roleHit ? ROLE_BONUS : 0;
        if (counted) countedMatchIds.add(s.hltvMatchId);
        return {
          ...s,
          counted,
          roleHit,
          rolePoints,
          points: counted ? s.placementPoints + s.winPoints + rolePoints : 0,
        };
      });
    const counted = matches.filter((m) => m.counted);
    const placementPoints = counted.reduce((n, m) => n + m.placementPoints, 0);
    const winPoints = counted.reduce((n, m) => n + m.winPoints, 0);
    const rolePoints = counted.reduce((n, m) => n + m.rolePoints, 0);
    // The player's HLTV team id comes from the match lines (authoritative for
    // who he actually played for), falling back to the pool.
    const teamId = matches[0]?.hltvTeamId ?? p?.hltvTeamId ?? null;
    const rec = teamId != null ? records.get(teamId) : undefined;
    const perfect =
      rec != null &&
      rec.wins >= 3 &&
      rec.losses === 0 &&
      rec.thirdWinStartMs != null &&
      rec.thirdWinStartMs >= fromMs &&
      rec.thirdWinStartMs >= startFloor;
    const perfectBonus = perfect ? SWISS_PERFECT_BONUS : 0;
    const base = placementPoints + winPoints + rolePoints + perfectBonus;
    return {
      playerId: slot.playerId,
      role: slot.role,
      captain,
      tier: p?.tier ?? null,
      multiplier,
      placementPoints,
      winPoints,
      rolePoints,
      perfectBonus,
      base,
      total: Math.round(base * multiplier),
      matches,
    };
  });
  return {
    total: players.reduce((n, p) => n + p.total, 0),
    players,
    matchesCounted: countedMatchIds.size,
  };
}

/**
 * What a set of newly read matches added to a lineup: its score with them
 * minus its score without them. Captain multipliers and a 3-0 bonus that one
 * of the new matches clinched are therefore included. Per player, best first;
 * players who gained nothing are left out.
 */
export function lineupGain(
  lineup: Lineup,
  lockedAtMs: number,
  ctx: ScoreContext,
  newMatchIds: ReadonlySet<number>,
): { gained: number; total: number; players: { playerId: number; points: number }[] } {
  const now = scoreLineup(lineup, lockedAtMs, ctx);
  const before = scoreLineup(lineup, lockedAtMs, { ...ctx, matches: ctx.matches.filter((m) => !newMatchIds.has(m.hltvMatchId)) });
  const prevOf = new Map(before.players.map((p) => [p.playerId, p.total]));
  const players = now.players
    .map((p) => ({ playerId: p.playerId, points: p.total - (prevOf.get(p.playerId) ?? 0) }))
    .filter((g) => g.points > 0)
    .sort((a, b) => b.points - a.points || a.playerId - b.playerId);
  return { gained: now.total - before.total, total: now.total, players };
}

/* ── Standings ────────────────────────────────────────────────────────── */

export interface StandingInput {
  managerId: string;
  /** Points per stage id; a stage the manager skipped is simply absent. */
  byStage: Readonly<Record<number, number>>;
}

export interface StandingRow extends StandingInput {
  total: number;
  /** 1-based; managers level on points share a rank ("1, 1, 3"). */
  rank: number;
}

/** Rank managers by total points (or one stage's when `stageId` is given). */
export function rankManagers(rows: readonly StandingInput[], stageId?: number): StandingRow[] {
  const scored = rows
    .map((r) => ({
      ...r,
      total:
        stageId != null
          ? (r.byStage[stageId] ?? 0)
          : Object.values(r.byStage).reduce((n, v) => n + v, 0),
    }))
    .sort((a, b) => b.total - a.total || a.managerId.localeCompare(b.managerId));
  let rank = 0;
  let prev: number | null = null;
  return scored.map((r, i) => {
    if (prev === null || r.total !== prev) rank = i + 1;
    prev = r.total;
    return { ...r, rank };
  });
}

/* ── Player table (stage leaders) ─────────────────────────────────────── */

export interface PlayerStageLine {
  playerId: number;
  matches: number;
  /** Placement + win points over the stage's scored matches (no roles, no captain). */
  points: number;
  kills: number;
  deaths: number;
  avgRating: number;
  wins: number;
  losses: number;
}

/** Every pool player's raw fantasy output over a stage, best first. */
export function playerStageTable(matches: readonly FantasyMatchData[], stageStartMs: number | null): PlayerStageLine[] {
  const floor = stageStartMs ?? -Infinity;
  const acc = new Map<number, PlayerStageLine & { ratingSum: number }>();
  for (const m of matches) {
    if (m.startMs < floor) continue;
    for (const s of scoreMatch(m)) {
      let a = acc.get(s.playerId);
      if (!a) {
        a = { playerId: s.playerId, matches: 0, points: 0, kills: 0, deaths: 0, avgRating: 0, wins: 0, losses: 0, ratingSum: 0 };
        acc.set(s.playerId, a);
      }
      a.matches++;
      a.points += s.placementPoints + s.winPoints;
      a.kills += s.kills;
      a.deaths += s.deaths;
      a.ratingSum += s.rating;
      if (s.won) a.wins++;
      else a.losses++;
    }
  }
  return [...acc.values()]
    .map(({ ratingSum, ...a }) => ({ ...a, avgRating: a.matches ? Math.round((ratingSum / a.matches) * 100) / 100 : 0 }))
    .sort((a, b) => b.points - a.points || b.avgRating - a.avgRating || a.playerId - b.playerId);
}

/* ── Stage phase ──────────────────────────────────────────────────────── */

/**
 * Where a stage is for the fantasy game:
 *   waiting — its teams are not known yet, nothing to draft
 *   open    — the pool is set and the stage has not started: draft and edit
 *   live    — started: lineups are revealed, late joiners may still enter once
 *   final   — played out: read-only
 */
export type StagePhase = "waiting" | "open" | "live" | "final";

export function stagePhase(opts: {
  poolReady: boolean;
  stageStartMs: number | null;
  nowMs: number;
  complete: boolean;
  frozen: boolean;
}): StagePhase {
  if (opts.complete || (opts.frozen && opts.poolReady)) return "final";
  if (!opts.poolReady) return "waiting";
  if (opts.stageStartMs != null && opts.nowMs >= opts.stageStartMs) return "live";
  return "open";
}

/** What a manager may do with a stage's lineup right now. */
export type LineupAction = "edit" | "join-late" | "none";

export function lineupAction(phase: StagePhase, hasLineup: boolean): LineupAction {
  if (phase === "open") return "edit";
  if (phase === "live" && !hasLineup) return "join-late";
  return "none";
}

/**
 * The teams of a stage when Valve's layout has not trimmed the section to its
 * real field yet: the section's direct seeds (teams not in the previous stage)
 * plus every team that won three matches in the previous stage. Returns null
 * until that adds up to exactly the stage's field size.
 */
export function deriveStageField(opts: {
  fieldSize: number;
  sectionPickids: readonly number[];
  previousSectionPickids: readonly number[];
  previousAdvancedPickids: readonly number[];
}): number[] | null {
  const prev = new Set(opts.previousSectionPickids);
  const seeds = opts.sectionPickids.filter((id) => id !== 0 && !prev.has(id));
  const field = [...new Set([...seeds, ...opts.previousAdvancedPickids])];
  return field.length === opts.fieldSize ? field : null;
}

/* ── Per-Major config ─────────────────────────────────────────────────── */

export interface FantasyEventConfig {
  /**
   * The HLTV event id of the Major's hub page. HLTV runs the last Swiss stage
   * and the playoffs under the hub, so its results page is where those matches
   * are listed.
   */
  hltvHubEventId: number;
  /**
   * stage id -> ISO instant from which that stage scores, when it is later
   * than the stage's first match. Matches before it count for nobody.
   */
  scoringStart?: Readonly<Record<number, string>>;
}

/** Keyed by Valve event id. A Major with no entry has no fantasy game. */
export const FANTASY_EVENTS: Readonly<Record<number, FantasyEventConfig>> = {
  // IEM Cologne 2026 (archived): kept so a finished stage can be replayed
  // through the real pipeline as a test.
  26: { hltvHubEventId: 8301 },
  // PGL Singapore 2026. Fantasy shipped after Stage I's first day, so Stage I
  // scores from day two (25 Nov) and everyone drafts on level terms.
  27: { hltvHubEventId: 8302, scoringStart: { 111: "2026-11-25T00:00:00Z" } },
};

/** The HLTV event id in an `/events/<id>/<slug>` url, or null. */
export function hltvEventIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/events\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * When a stage starts scoring: its first match (the Pick'Em lock), or the
 * configured later `scoringStart`. Null while the stage's first match is
 * unpublished.
 */
export function stageScoringStartMs(
  eventId: number,
  stageId: number,
  lockIso: string | null | undefined,
): number | null {
  const lock = lockIso ? Date.parse(lockIso) : NaN;
  const override = Date.parse(FANTASY_EVENTS[eventId]?.scoringStart?.[stageId] ?? "");
  if (Number.isFinite(lock) && Number.isFinite(override)) return Math.max(lock, override);
  if (Number.isFinite(lock)) return lock;
  return null;
}

/**
 * Which stage an ingested match belongs to, given the HLTV event page it was
 * listed under. A Swiss stage with its own HLTV event page owns every match
 * there. The hub lists the last Swiss stage and the playoffs together; HLTV's
 * info line ("Quarter-final", "Semi-final", "Grand final") tells them apart.
 */
export function stageForMatch(opts: {
  stages: readonly FantasyStage[];
  /** stage id -> the HLTV event id its matches are listed under. */
  stageHltvEvent: Readonly<Record<number, number>>;
  listedUnderHltvEvent: number;
  info: string;
}): FantasyStage | null {
  const candidates = opts.stages.filter((s) => opts.stageHltvEvent[s.id] === opts.listedUnderHltvEvent);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const playoff = isPlayoffInfo(opts.info);
  const swiss = candidates.filter((s) => s.kind === "swiss");
  return playoff
    ? (candidates.find((s) => s.kind === "playoff") ?? null)
    : (swiss[swiss.length - 1] ?? null);
}
