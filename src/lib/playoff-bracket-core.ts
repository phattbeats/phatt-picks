/**
 * Live playoffs bracket (pure, PHA-903).
 *
 * Companion to the Swiss bracket (PHA-902). Where the Swiss flow is a wide W:L
 * lattice, the playoffs are a single-elimination tree: Quarterfinals (4 matches)
 * → Semifinals (2) → Grand Final (1), winners advancing. Brandon wants the
 * locked playoffs view to look like the reference he shared — the QF/SF/GF tree
 * with team logos, series scores and winners lit, all `???` until teams seed in.
 *
 * Unlike the Swiss bracket — which we lift wholesale from an HLTV crawl — the
 * playoff TREE is already fully described by our committed layout: sections
 *   108 Quarterfinals (4 match groups) · 109 Semifinals (2) · 110 Grand Final (1)
 * each group = one match with two team slots (pickid 0 = TBD) and one pick slot
 * (the team the viewer called to win). So this module builds the bracket from
 * the layout the app already has, enriched with two live facts the rest of the
 * app already tracks:
 *   - the viewer's pick per match (their saved Pick row), and
 *   - the resolved winner per match (a StageOutcome row), as Stage 3 resolves
 *     and Valve seeds the bracket.
 * No external source is required for the structure or the results — the bracket
 * fills in live via the same on-read layout/outcome refresh the rest of /picks
 * uses. (Live per-series MAP scores — "2:1" inside a Bo3 — are the one field the
 * answer key can't give; `scoreByGroup` is the optional seam for an HLTV overlay
 * once the playoff event page exists and can be captured + verified, as PHA-902
 * did for Swiss. Until then a decided match simply lights its winner, no
 * fabricated score.)
 *
 * TRUTHFUL BY CONSTRUCTION: an unseeded slot is TBD; a winner is shown only when
 * a real outcome resolved it; a viewer pick is a hit/miss only once the match is
 * decided. Nothing here invents a result.
 *
 * Pure leaf: no `@/` alias, no prisma, no fetch — only a type-only import of the
 * layout shape (erased at runtime), so the verify harness loads it under node.
 */

import type { Section } from "./layout";

export type PlayoffRoundKey = "QF" | "SF" | "GF";

export interface PlayoffRoundDef {
  sectionId: number;
  key: PlayoffRoundKey;
  /** Long header, e.g. "QUARTERFINALS". */
  label: string;
  /** Short tag, e.g. "QF". */
  short: string;
}

/**
 * The committed IEM Cologne 2026 single-elim sections, in bracket order. These
 * section ids are the Valve layout's (see cologne-layout.json / stage-gate-core):
 * 108 Quarterfinals · 109 Semifinals · 110 Grand Final. Order is QF → SF → GF
 * so a left-to-right column render reads as the tree.
 */
export const PLAYOFF_ROUNDS: readonly PlayoffRoundDef[] = [
  { sectionId: 108, key: "QF", label: "QUARTERFINALS", short: "QF" },
  { sectionId: 109, key: "SF", label: "SEMIFINALS", short: "SF" },
  { sectionId: 110, key: "GF", label: "GRAND FINAL", short: "GF" },
];

const PLAYOFF_SECTION_IDS = new Set(PLAYOFF_ROUNDS.map((r) => r.sectionId));

/** Is this section one of the single-elim playoff rounds (108/109/110)? */
export function isPlayoffSection(sectionId: number): boolean {
  return PLAYOFF_SECTION_IDS.has(sectionId);
}

/** The round definition for a section id, or null when it isn't a playoff round. */
export function playoffRoundForSection(sectionId: number): PlayoffRoundDef | null {
  return PLAYOFF_ROUNDS.find((r) => r.sectionId === sectionId) ?? null;
}

/** Outcome of the viewer's call for a match, once it can be judged. */
export type PlayoffPickResult = "hit" | "miss" | "pending";

/** One side of a playoff match. */
export interface PlayoffSide {
  /** Layout pickid for the seeded team, or null when the slot is still TBD. */
  pickid: number | null;
  /** Series/map score from a live source (HLTV overlay); null until that exists. */
  score: number | null;
  /** This team won the match (from the resolved outcome). */
  winner: boolean;
  /** The viewer called this team to win this match. */
  userPicked: boolean;
}

export interface PlayoffMatch {
  groupId: number;
  /** Short match label from the layout group name, e.g. "Match 1" / "Final". */
  label: string;
  team1: PlayoffSide;
  team2: PlayoffSide;
  /** Both slots carry a real team (the match is set). */
  seeded: boolean;
  /** A winner has been resolved. */
  decided: boolean;
  /**
   * The viewer's call for this match: hit / miss once decided, pending while the
   * match is still to be played, or null when they made no pick for it.
   */
  userResult: PlayoffPickResult | null;
}

export interface PlayoffRound {
  key: PlayoffRoundKey;
  label: string;
  short: string;
  sectionId: number;
  matches: PlayoffMatch[];
}

export interface PlayoffBracket {
  rounds: PlayoffRound[];
  /** At least one match has both teams seeded. */
  anySeeded: boolean;
  /** At least one match has a resolved winner. */
  anyDecided: boolean;
  totalMatches: number;
  /** The Grand Final winner's pickid once it's decided (the champion), else null. */
  championPickid: number | null;
}

export interface PlayoffInputs {
  /** The playoff sections present in the layout (108/109/110), any order. */
  sections: readonly Section[];
  /** groupId → the pickid the viewer called to win that match. */
  userPickByGroup?: ReadonlyMap<number, number>;
  /** groupId → the resolved winner pickid for that match. */
  winnerByGroup?: ReadonlyMap<number, number>;
  /** groupId → live series scores [team1Score, team2Score] (optional HLTV overlay). */
  scoreByGroup?: ReadonlyMap<number, readonly [number, number]>;
}

/** Reduce a layout group name to its short match label ("...| Match 1" → "Match 1"). */
function matchLabel(name: string): string {
  const i = name.lastIndexOf("|");
  const tail = (i >= 0 ? name.slice(i + 1) : name).trim();
  return tail.length > 0 ? tail : name.trim();
}

/**
 * Build the single-elim bracket from the committed playoff sections plus the
 * viewer's picks and resolved winners. Rounds come out in QF → SF → GF order
 * (only those present in `sections`); a section we don't recognise is ignored.
 * Pure and total: missing maps mean "no pick / not decided yet" — never throws,
 * never fabricates a team or a result.
 */
export function buildPlayoffBracket(inputs: PlayoffInputs): PlayoffBracket {
  const { sections, userPickByGroup, winnerByGroup, scoreByGroup } = inputs;
  const byId = new Map<number, Section>();
  for (const s of sections) byId.set(s.sectionid, s);

  const rounds: PlayoffRound[] = [];
  let anySeeded = false;
  let anyDecided = false;
  let totalMatches = 0;
  let championPickid: number | null = null;

  for (const def of PLAYOFF_ROUNDS) {
    const section = byId.get(def.sectionId);
    if (!section) continue;

    const matches: PlayoffMatch[] = section.groups.map((g) => {
      const t1 = g.teams[0]?.pickid ?? 0;
      const t2 = g.teams[1]?.pickid ?? 0;
      const winner = winnerByGroup?.get(g.groupid) ?? null;
      const userPick = userPickByGroup?.get(g.groupid) ?? null;
      const scores = scoreByGroup?.get(g.groupid) ?? null;

      const seeded = t1 !== 0 && t2 !== 0;
      const decided = winner != null;

      const side = (pickid: number, score: number | null): PlayoffSide => ({
        pickid: pickid === 0 ? null : pickid,
        score,
        winner: decided && pickid !== 0 && pickid === winner,
        userPicked: pickid !== 0 && userPick != null && userPick !== 0 && pickid === userPick,
      });

      let userResult: PlayoffPickResult | null = null;
      if (userPick != null && userPick !== 0) {
        userResult = decided ? (userPick === winner ? "hit" : "miss") : "pending";
      }

      totalMatches++;
      if (seeded) anySeeded = true;
      if (decided) anyDecided = true;

      return {
        groupId: g.groupid,
        label: matchLabel(g.name),
        team1: side(t1, scores ? scores[0] : null),
        team2: side(t2, scores ? scores[1] : null),
        seeded,
        decided,
        userResult,
      };
    });

    if (def.key === "GF" && matches[0]?.decided) {
      championPickid = winnerByGroup?.get(matches[0].groupId) ?? null;
    }

    rounds.push({
      key: def.key,
      label: def.label,
      short: def.short,
      sectionId: def.sectionId,
      matches,
    });
  }

  return { rounds, anySeeded, anyDecided, totalMatches, championPickid };
}

/** Tally the viewer's playoff calls across the whole bracket (for header copy). */
export interface PlayoffPickSummary {
  picks: number;
  hits: number;
  misses: number;
  pending: number;
}

export function summarizePlayoffPicks(bracket: PlayoffBracket): PlayoffPickSummary {
  let picks = 0;
  let hits = 0;
  let misses = 0;
  let pending = 0;
  for (const round of bracket.rounds) {
    for (const m of round.matches) {
      if (m.userResult == null) continue;
      picks++;
      if (m.userResult === "hit") hits++;
      else if (m.userResult === "miss") misses++;
      else pending++;
    }
  }
  return { picks, hits, misses, pending };
}
