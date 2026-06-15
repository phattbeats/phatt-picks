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

/**
 * The set of teams seeded into the playoff field — every non-TBD team that
 * appears in the Quarterfinal section's match groups (the eight survivors).
 *
 * This is the eligibility universe for the WHOLE bracket (PHA-1204): a viewer's
 * Semifinal / Grand Final pick is one of their own advanced teams, none of which
 * the layout has placed on the SF/GF group slots yet (those stay TBD until the
 * matches are actually played). So a pick for a downstream round targets a team
 * seeded in the QF section, not in its own group — this set is what the picks
 * API validates such a pick against. Empty until Valve seeds the bracket.
 */
export function playoffFieldTeams(sections: readonly Section[]): Set<number> {
  const field = new Set<number>();
  const qf = sections.find((s) => s.sectionid === PLAYOFF_ROUNDS[0].sectionId);
  if (!qf) return field;
  for (const g of qf.groups) {
    for (const t of g.teams) {
      if (t.pickid !== 0) field.add(t.pickid);
    }
  }
  return field;
}

/* ------------------------------------------------------------------------- *
 * Interactive bracket predictor (PHA-1204)
 *
 * Brandon: "Playoffs: it is ONE stage, you place the whole bracket at once."
 * The old picker stacked three separate boards (QF/SF/GF) and only let you pick
 * a round once Valve had seeded its teams — so you could never fill in the
 * Semifinals or Final ahead of time. The bracket predictor below models the
 * tournament truth: you crown a winner in each Quarterfinal and that team
 * ADVANCES into the Semifinal it feeds, and so on to the Final. The SF/GF
 * participants are derived from YOUR picks, not from the layout, so the whole
 * tree is fillable the moment the eight QF teams seed in.
 *
 * Pure + total: the model is the committed bracket shape; resolving picks against
 * it never throws and never fabricates a team. Re-picking an upstream match
 * cascades — any downstream pick that no longer has its team in play is dropped.
 * ------------------------------------------------------------------------- */

/** One side of a predictor match: a seeded team (QF) or a feeder match (SF/GF). */
export interface BracketSide {
  /** Seeded team pickid for this side (Quarterfinals only), else null. */
  seed: number | null;
  /** The match whose winner advances into this side (SF/GF), else null. */
  feederGroupId: number | null;
}

export interface BracketPickMatch {
  groupId: number;
  sectionId: number;
  round: PlayoffRoundKey;
  /** Short match label, e.g. "Match 1" / "Final". */
  label: string;
  top: BracketSide;
  bottom: BracketSide;
}

export interface BracketPickRound {
  key: PlayoffRoundKey;
  label: string;
  short: string;
  sectionId: number;
  matches: BracketPickMatch[];
}

export interface BracketPickModel {
  rounds: BracketPickRound[];
  /** The Grand Final match group, or null if the GF section isn't present. */
  finalGroupId: number | null;
}

/**
 * Build the predictor tree from the committed playoff sections. QF matches carry
 * their two seeded teams; each later-round match's two sides are FED by the two
 * matches below it (match j in round r is fed by matches 2j and 2j+1 of round
 * r-1 — the same pairing the read-only bracket draws its connectors from). Order
 * is QF → SF → GF; a missing round just truncates the tree.
 */
export function buildPlayoffPickTree(sections: readonly Section[]): BracketPickModel {
  const byId = new Map<number, Section>();
  for (const s of sections) byId.set(s.sectionid, s);

  const rounds: BracketPickRound[] = [];
  let prev: BracketPickMatch[] = [];
  let finalGroupId: number | null = null;

  for (const def of PLAYOFF_ROUNDS) {
    const section = byId.get(def.sectionId);
    if (!section) {
      prev = [];
      continue;
    }
    const isQF = def.key === "QF";
    const matches: BracketPickMatch[] = section.groups.map((g, j) => {
      const top: BracketSide = isQF
        ? { seed: (g.teams[0]?.pickid ?? 0) || null, feederGroupId: null }
        : { seed: null, feederGroupId: prev[2 * j]?.groupId ?? null };
      const bottom: BracketSide = isQF
        ? { seed: (g.teams[1]?.pickid ?? 0) || null, feederGroupId: null }
        : { seed: null, feederGroupId: prev[2 * j + 1]?.groupId ?? null };
      return {
        groupId: g.groupid,
        sectionId: section.sectionid,
        round: def.key,
        label: matchLabel(g.name),
        top,
        bottom,
      };
    });
    if (def.key === "GF") finalGroupId = matches[0]?.groupId ?? null;
    rounds.push({ key: def.key, label: def.label, short: def.short, sectionId: def.sectionId, matches });
    prev = matches;
  }

  return { rounds, finalGroupId };
}

/** A match's two resolved participants, given the picks made so far. */
export interface ResolvedMatch {
  top: number | null;
  bottom: number | null;
}

export interface ResolvedBracket {
  /** groupId → the two teams currently in that match (null = undecided/TBD). */
  participants: Map<number, ResolvedMatch>;
  /** groupId → the viewer's winner, after cascade-pruning impossible picks. */
  picks: Record<number, number>;
  /** The predicted champion (Grand Final winner), or null. */
  championPickid: number | null;
}

/**
 * Resolve a set of raw winner picks against the tree. Walks the rounds in order
 * so each match sees the (already pruned) winners feeding it, then keeps the
 * viewer's pick only when that team is actually one of the two participants —
 * dropping any pick orphaned by an upstream change. Pure: never mutates inputs.
 */
export function resolveBracketPicks(
  model: BracketPickModel,
  rawPicks: Readonly<Record<number, number>>,
): ResolvedBracket {
  const participants = new Map<number, ResolvedMatch>();
  const picks: Record<number, number> = {};

  const sideTeam = (side: BracketSide): number | null =>
    side.seed != null
      ? side.seed
      : side.feederGroupId != null
        ? picks[side.feederGroupId] ?? null
        : null;

  for (const round of model.rounds) {
    for (const m of round.matches) {
      const top = sideTeam(m.top);
      const bottom = sideTeam(m.bottom);
      participants.set(m.groupId, { top, bottom });
      const cur = rawPicks[m.groupId] ?? 0;
      if (cur !== 0 && (cur === top || cur === bottom)) picks[m.groupId] = cur;
    }
  }

  const championPickid =
    model.finalGroupId != null ? picks[model.finalGroupId] ?? null : null;

  return { participants, picks, championPickid };
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
