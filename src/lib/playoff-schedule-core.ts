/**
 * Playoff schedule discovery: the pure half (PHA-5276).
 *
 * The last per-Major hand edit is `playoffSchedule`, the per-game start times
 * of the bracket. HLTV publishes them on the event's match list
 * (`/events/<hub>/matches`) well before the teams are known: every game is an
 * entry with its unix start (`data-unix`) and a stable label ("Quarter-final
 * #1", "Semi-final #2", "Grand Final"), even while both teams are TBD.
 * Singapore's hub listed all seven on 2026-11-27, two weeks before the first
 * quarterfinal.
 *
 * This module reads that list and proposes a `playoffSchedule`. Rules:
 *   - nothing is estimated: a round is proposed only when HLTV lists every
 *     game of it with a time (4 QF, 2 SF, 1 GF), otherwise it is left out;
 *   - games are ordered by HLTV's ordinal (#1..#n), which is HLTV's bracket
 *     order. The bracket lock (`derivePlayoffLocks`, the earliest game) does
 *     not depend on that order. Only the per-game time shown on each slot does;
 *   - the 3rd-place decider has no Pick'Em slot and is ignored;
 *   - committed values and the lock freeze are applied by the caller
 *     (`mergePlayoffProposal`), never here.
 *
 * Pure: no prisma, no fetch, no `@/` alias, so scripts/verify-playoff-schedule.ts
 * runs it under `node --experimental-strip-types`.
 */

export type PlayoffRound = "qf" | "sf" | "gf";

/** One entry of an HLTV event match list. */
export interface HltvListedMatch {
  matchId: number;
  startMs: number;
  /** HLTV's label, e.g. "PGL Major Singapore 2026 - Quarter-final #1". */
  label: string;
  round: PlayoffRound | null;
  /** 1-based ordinal within the round (the "#n"); 1 for the Grand Final. */
  ordinal: number | null;
  /** HLTV team ids from the wrapper attributes, null while TBD. */
  team1: string | null;
  team2: string | null;
}

/** Games per round in a Major's 8-team single-elimination bracket. */
export const ROUND_SIZE: Readonly<Record<PlayoffRound, number>> = { qf: 4, sf: 2, gf: 1 };

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** "Quarter-final #3" -> { qf, 3 }; "Grand Final" -> { gf, 1 }; else nulls. */
export function classifyPlayoffLabel(label: string): { round: PlayoffRound | null; ordinal: number | null } {
  const l = label.toLowerCase();
  if (/3rd place|third place|decider/.test(l)) return { round: null, ordinal: null };
  const n = /#\s*(\d+)/.exec(l);
  const ordinal = n ? Number(n[1]) : null;
  if (/quarter[\s-]?finals?/.test(l)) return { round: "qf", ordinal };
  if (/semi[\s-]?finals?/.test(l)) return { round: "sf", ordinal };
  if (/grand[\s-]?finals?/.test(l)) return { round: "gf", ordinal: ordinal ?? 1 };
  return { round: null, ordinal: null };
}

/**
 * Parse every match entry of an HLTV `/events/<id>/matches` page. Entries
 * without a parseable start time are dropped (an untimed slot is not a time).
 */
export function parseHltvMatchList(html: string): HltvListedMatch[] {
  const out: HltvListedMatch[] = [];
  const parts = html.split(/<div class="match-wrapper\b/).slice(1);
  for (const part of parts) {
    const id = /data-match-id="(\d+)"/.exec(part);
    const unix = /data-unix="(\d+)"/.exec(part);
    if (!id || !unix) continue;
    const startMs = Number(unix[1]);
    if (!Number.isFinite(startMs) || startMs <= 0) continue;
    const t1 = /\bteam1="([^"]*)"/.exec(part)?.[1] ?? "";
    const t2 = /\bteam2="([^"]*)"/.exec(part)?.[1] ?? "";
    const labelRaw =
      /class="line-clamp-3">([^<]*)</.exec(part)?.[1] ??
      /href="\/matches\/\d+\/([^"]+)"/.exec(part)?.[1]?.replace(/-/g, " ") ??
      "";
    const label = decode(labelRaw);
    out.push({
      matchId: Number(id[1]),
      startMs,
      label,
      ...classifyPlayoffLabel(label),
      team1: t1 ? t1 : null,
      team2: t2 ? t2 : null,
    });
  }
  return out;
}

/**
 * Map a registry's playoff section names onto rounds ("Quarterfinals" -> qf).
 * Returns only the sections it recognises.
 */
export function playoffSectionsByRound(
  sectionNames: Readonly<Record<number, string>>,
): Partial<Record<PlayoffRound, number>> {
  const out: Partial<Record<PlayoffRound, number>> = {};
  for (const [key, name] of Object.entries(sectionNames)) {
    const { round } = classifyPlayoffLabel(name);
    if (round && out[round] === undefined) out[round] = Number(key);
  }
  return out;
}

/**
 * Propose a `playoffSchedule` (sectionId -> ISO starts, HLTV ordinal order)
 * from a parsed match list. A round is included only when HLTV lists exactly
 * one timed game for every ordinal 1..ROUND_SIZE; a partial or ambiguous round
 * is left out, so it stays dark rather than half-dated.
 */
export function proposePlayoffSchedule(
  matches: readonly HltvListedMatch[],
  sectionNames: Readonly<Record<number, string>>,
): Record<number, string[]> {
  const sections = playoffSectionsByRound(sectionNames);
  const out: Record<number, string[]> = {};
  for (const round of Object.keys(ROUND_SIZE) as PlayoffRound[]) {
    const sectionId = sections[round];
    if (sectionId === undefined) continue;
    const size = ROUND_SIZE[round];
    const games = matches.filter((m) => m.round === round);
    if (games.length !== size) continue;
    const byOrdinal = new Map<number, HltvListedMatch>();
    for (const g of games) if (g.ordinal !== null) byOrdinal.set(g.ordinal, g);
    if (byOrdinal.size !== size) continue;
    const times: string[] = [];
    for (let i = 1; i <= size; i++) {
      const g = byOrdinal.get(i);
      if (!g) break;
      times.push(new Date(g.startMs).toISOString());
    }
    if (times.length === size) out[sectionId] = times;
  }
  return out;
}

/**
 * Apply a proposal under the issue's three rules:
 *   1. committed wins: a section with committed games keeps them untouched;
 *   2. frozen at lock: once the bracket has locked (`nowMs >= lockMs` of the
 *      previously effective schedule), the previous effective schedule is
 *      returned unchanged, so a late HLTV edit can't move a locked bracket;
 *   3. never invent: sections the proposal does not cover stay as they were.
 * Valve's `picks_allowed` remains the hard lock elsewhere (isStageLocked).
 */
export function mergePlayoffProposal(input: {
  committed: Readonly<Record<number, readonly string[]>>;
  previous: Readonly<Record<number, readonly string[]>>;
  proposal: Readonly<Record<number, readonly string[]>>;
  nowMs: number;
}): Record<number, readonly string[]> {
  const { committed, previous, proposal, nowMs } = input;
  const prevLock = earliestMs(previous);
  if (prevLock !== null && nowMs >= prevLock) return { ...previous };
  const out: Record<number, readonly string[]> = { ...previous };
  for (const [key, times] of Object.entries(proposal)) {
    const id = Number(key);
    if ((committed[id]?.length ?? 0) > 0) continue;
    out[id] = [...times];
  }
  for (const [key, times] of Object.entries(committed)) {
    if (times.length > 0) out[Number(key)] = times;
  }
  return out;
}

function earliestMs(schedule: Readonly<Record<number, readonly string[]>>): number | null {
  let min: number | null = null;
  for (const times of Object.values(schedule)) {
    for (const iso of times) {
      const ms = Date.parse(iso);
      if (!Number.isNaN(ms) && (min === null || ms < min)) min = ms;
    }
  }
  return min;
}

/**
 * The match list of the HLTV event a stage page belongs to:
 * `https://www.hltv.org/events/8302/pgl-major-singapore-2026` ->
 * `https://www.hltv.org/events/8302/matches`. Null for anything that is not an
 * HLTV event URL (never guess a page).
 */
export function hltvMatchListUrl(eventPageUrl: string): string | null {
  const m = /^https:\/\/www\.hltv\.org\/events\/(\d+)(?:[/?#]|$)/.exec(eventPageUrl.trim());
  return m ? `https://www.hltv.org/events/${m[1]}/matches` : null;
}

/**
 * Which HLTV page lists the playoff games: the event page of the LAST Swiss
 * stage (the one that runs "Stage 3 & Playoffs" under the hub), from the
 * effective sources first, else the discovered-but-unsourced page. Null until
 * that page is known.
 */
export function playoffMatchListSource(input: {
  swissSectionIds: readonly number[];
  sources: Readonly<Record<number, { url: string } | undefined>>;
  discovered: Readonly<Record<number, string | undefined>>;
}): string | null {
  const last = [...input.swissSectionIds].sort((a, b) => b - a)[0];
  if (last === undefined) return null;
  const page = input.sources[last]?.url ?? input.discovered[last];
  return page ? hltvMatchListUrl(page) : null;
}
