/**
 * Start times for the Swiss bracket's not-yet-paired slots (PHA-5538, round 2).
 *
 * HLTV publishes a Swiss stage's whole schedule on the event's match list
 * (`/events/<id>/matches`) days before the pairings exist: every game is an
 * entry with its unix start and a label "... Swiss Round <r> #<n>", teams
 * blank. The bracket page we already crawl only draws a round once it is
 * paired, so without the list an unpaired box is a row of bare "VS" slots.
 *
 * Which record box a game lands in is not in the label. It is in HLTV's
 * numbering, observed on Singapore Stage I (9303) and Stage II (9304) on
 * 2026-11-28 by matching each paired box's match ids back to the list:
 *   R1  0:0  #1..#8
 *   R2  1:0  #1 #3 #5 #7     0:1  #2 #4 #6 #8
 *   R3  1:1  #1..#4          2:0  #5 #7          0:2  #6 #8
 *   R4  2:1  #1 #3 #5        1:2  #2 #4 #6
 *   R5  2:2  #1..#3
 * Both stages agree on every round. verify-swiss-slot-times re-checks it
 * against the recorded observation, so a different numbering fails loudly in
 * the test, not quietly on the page.
 *
 * Rules:
 *   - nothing is estimated: a slot shows a time only when HLTV lists that
 *     exact ordinal with a time; otherwise it stays a bare "VS";
 *   - a paired game drops its "Swiss Round" label on HLTV (it shows teams), so
 *     it leaves this mapping and the bracket cell's own time takes over;
 *   - a partly paired box keeps its paired cells and fills only the remaining
 *     slots, from the ordinals that are still listed unpaired.
 *
 * Pure: no prisma, no fetch, no `@/` alias, so scripts/verify-swiss-slot-times.ts
 * runs it under `node --experimental-strip-types`.
 */

import type { HltvListedMatch } from "./playoff-schedule-core";

/** One unpaired Swiss game from an HLTV event match list. */
export interface ListedSwissGame {
  matchId: number;
  startMs: number;
  round: number;
  ordinal: number;
}

/** Which "#n" of round `r` sits in each record box, in HLTV's numbering. */
export const SWISS_BOX_ORDINALS: Readonly<Record<string, readonly number[]>> = {
  "0:0": [1, 2, 3, 4, 5, 6, 7, 8],
  "1:0": [1, 3, 5, 7],
  "0:1": [2, 4, 6, 8],
  "1:1": [1, 2, 3, 4],
  "2:0": [5, 7],
  "0:2": [6, 8],
  "2:1": [1, 3, 5],
  "1:2": [2, 4, 6],
  "2:2": [1, 2, 3],
};

/** "... Stage 2 - Swiss Round 4 #3" -> { round: 4, ordinal: 3 }; else null. */
export function parseSwissRoundLabel(label: string): { round: number; ordinal: number } | null {
  const m = /swiss\s+round\s+(\d+)\s*#\s*(\d+)/i.exec(label);
  if (!m) return null;
  const round = Number(m[1]);
  const ordinal = Number(m[2]);
  if (!(round >= 1 && round <= 5) || !(ordinal >= 1)) return null;
  return { round, ordinal };
}

/** The Swiss round a record box plays: "2:1" -> 4. Null for anything else. */
export function boxRound(label: string): number | null {
  const m = /^(\d):(\d)$/.exec(label);
  if (!m) return null;
  const r = Number(m[1]) + Number(m[2]) + 1;
  return r >= 1 && r <= 5 ? r : null;
}

/**
 * Every unpaired, timed Swiss game in a parsed HLTV match list
 * (`parseHltvMatchList`). A hub list also carries the playoff games; they have
 * no "Swiss Round" label and drop out.
 */
export function listedSwissGames(
  matches: readonly Pick<HltvListedMatch, "matchId" | "startMs" | "label">[],
): ListedSwissGame[] {
  const out: ListedSwissGame[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const r = parseSwissRoundLabel(m.label);
    if (!r) continue;
    const key = `${r.round}#${r.ordinal}`;
    if (seen.has(key)) continue; // a duplicated entry never doubles a slot
    seen.add(key);
    out.push({ matchId: m.matchId, startMs: m.startMs, ...r });
  }
  return out.sort((a, b) => a.round - b.round || a.ordinal - b.ordinal);
}

/**
 * Start times for a box's unpaired slots, in slot order: the box's ordinals
 * that HLTV still lists unpaired. `paired` is how many cells the bracket
 * already draws in the box; at most `cells - paired` times come back.
 */
export function slotTimesForBox(
  label: string,
  games: readonly ListedSwissGame[],
  paired: number,
  cells: number,
): number[] {
  const round = boxRound(label);
  const ordinals = SWISS_BOX_ORDINALS[label];
  if (round === null || !ordinals) return [];
  const byOrdinal = new Map(games.filter((g) => g.round === round).map((g) => [g.ordinal, g.startMs]));
  const times: number[] = [];
  for (const o of ordinals) {
    const t = byOrdinal.get(o);
    if (t !== undefined) times.push(t);
  }
  return times.slice(0, Math.max(0, cells - paired));
}

/**
 * The stage's first listed game, for the "starts in" countdown on a stage
 * that hasn't started: the earliest round-1 game while round 1 is unpaired.
 * Null once round 1 is paired (the bracket cells carry the times then) or
 * when nothing is listed.
 */
export function firstListedStartMs(games: readonly ListedSwissGame[]): number | null {
  let min: number | null = null;
  for (const g of games) if (g.round === 1 && (min === null || g.startMs < min)) min = g.startMs;
  return min;
}
