/**
 * Stage Wrapped — content + deck builder (PHA-1054).
 *
 * The PHA-1052 shell consumes a `WrappedSlide[]` and knows nothing about how
 * the slides are sourced. This module is that source for the resolved Swiss
 * stages: the authored "craziest moments" for each stage (real IEM Cologne 2026
 * data — see `docs/STAGE-WRAPPED-S1-S2-DRAFT.md`) plus a pure builder that folds
 * in the viewer's personal beats (stage score, rank move, best call) reused from
 * the reveal/rank-snapshot data the reveal page already computes.
 *
 * Framework-free and deterministic so `verify-stage-wrapped-content.ts` can
 * exercise it offline. The two invariants the verify pins:
 *   1. NO-OP before content exists — a section with no authored moments (e.g.
 *      Stage III before it's written, or any stage pre-resolve when the caller
 *      gates on `sectionResolved`) yields an EMPTY deck. The shell then shows its
 *      honest "nothing to wrap yet" card and the launcher never auto-opens.
 *   2. The personal slides only appear when personal data is supplied (a
 *      signed-in viewer with a resolved stage); signed-out gets the stage's
 *      moments + a sign-in outro, never fabricated personal numbers.
 */

import { stageNumeral, type WrappedSlide, type WrappedSlideKind, type WrappedTeamLogo } from "./stage-wrapped-core";

/** Per-slide auto-advance for the recap (floored by the shell to MIN_AUTO_ADVANCE_MS). */
const AUTO_MS = 6000;

/**
 * Visual assets the deck builder needs but can't compute itself (pure): a
 * team-logo resolver (pickId → cascade tiers + name, from the reveal page's
 * teamMap + logo manifest) and the brand marks. Optional so the builder still
 * yields a valid text-only deck offline; the verify exercises both paths.
 */
export interface StageWrappedAssets {
  resolveTeamLogo?: (pickId: number) => WrappedTeamLogo | null;
  /** Major mark, e.g. "/watch/iem-cologne.png" (already white on dark). */
  majorLogoSrc?: string;
  /** Game mark, e.g. "/watch/counter-strike.png". */
  gameLogoSrc?: string;
}

/** Rank movement for the viewer this stage (matches rank-snapshot-core's RankDelta). */
export interface StageWrappedRankMove {
  delta: number | null;
  direction: "up" | "down" | "flat" | "new";
}

/** The viewer's lowest-consensus correct call this stage (their boldest right read). */
export interface StageWrappedBestCall {
  /** Team pickid, for the logo. */
  pickId: number;
  teamName: string;
  /** Swiss bucket tag, e.g. "3:0" / "0:3"; null for untagged/playoff slots. */
  tag: string | null;
  /** Field share % who also made this exact call. */
  pct: number;
  /** How many of the field also got it right, out of how many picked the slot. */
  count: number;
  total: number;
}

/** The viewer's personal beats, assembled by the caller from reveal/snapshot data. */
export interface StageWrappedPersonal {
  displayName?: string | null;
  /** Points earned this stage. */
  stagePoints: number;
  /** Correct calls / resolved slots this stage. */
  correct: number;
  resolvedSlots: number;
  /** Cumulative points across all resolved stages. */
  totalPoints: number;
  /** Rank after this stage resolved (1-based), or null if unranked. */
  rankAfter: number | null;
  rankMove: StageWrappedRankMove | null;
  bestCall?: StageWrappedBestCall | null;
  /** The viewer's avatar (src null → initials), for the personal score slide. */
  avatar?: { src: string | null; label: string } | null;
}

interface AuthoredMoment {
  id: string;
  kind: Extract<WrappedSlideKind, "stat" | "moment">;
  eyebrow: string;
  headline: string;
  figure?: string;
  figureCaption?: string;
  body?: string;
  /** Team pickids whose logos illustrate this moment (matchup / clinchers). */
  logoPickIds?: number[];
}

interface AuthoredStage {
  intro: { headline: string; body: string };
  moments: AuthoredMoment[];
}

/**
 * Authored stage decks — real, sourced IEM Cologne 2026 beats. Keyed by Swiss
 * section id (105 = Stage I, 106 = Stage II). A section absent here has no recap
 * yet, so `buildStageWrappedDeck` returns an empty deck for it (the no-op).
 * The shipped slide renderer shows eyebrow + figure + headline + body (no logo
 * slot yet), so each matchup is carried in the figure/caption copy.
 */
const AUTHORED: Record<number, AuthoredStage> = {
  // Stage I (HLTV 9028) — the favorites fell and the impossible happened.
  105: {
    intro: {
      headline: "Sixteen walked in. Eight walked out.",
      body: "The opening Swiss is done. Before you see how you called it — here's how Stage I actually went down.",
    },
    moments: [
      {
        id: "s1-upset-flyquest-liquid",
        kind: "moment",
        eyebrow: "BIGGEST UPSET",
        headline: "FlyQuest buried a giant",
        figure: "#81 › #25",
        figureCaption: "FlyQuest 2-0 Team Liquid",
        body: "World #81 FlyQuest met pre-event favorite Liquid in a win-or-go-home match and demolished the opener 13-2 before closing the sweep. The biggest ranking-gap exit of the stage.",
        logoPickIds: [132, 48],
      },
      {
        id: "s1-comeback-big-nrg",
        kind: "moment",
        eyebrow: "THE COMEBACK",
        headline: "Down 0-12. Won sixteen straight.",
        figure: "0-12 → 16-12",
        figureCaption: "BIG def. NRG on Mirage, in OT",
        body: "Deciding map, last ticket to Stage II. NRG raced to a flawless 12-0 half — then BIG won sixteen rounds in a row to take it in overtime. The first 0-12 comeback in Major history, in the home building, peaking near 500K viewers.",
        logoPickIds: [69, 87],
      },
      {
        id: "s1-flawless-betboom-b8",
        kind: "stat",
        eyebrow: "FLAWLESS",
        headline: "Two teams. Zero losses.",
        figure: "3-0",
        figureCaption: "BetBoom and B8 swept the field",
        body: "BetBoom ran the table at +29 round diff; B8 matched them — including a 22-20 Inferno marathon — to make it two perfect runs into Stage II.",
        logoPickIds: [137, 135],
      },
      {
        id: "s1-fallen-liquid-heroic",
        kind: "moment",
        eyebrow: "THE GIANTS FELL",
        headline: "Two top-30 seeds. Both out.",
        figure: "#25 · #27",
        figureCaption: "Liquid and HEROIC eliminated",
        body: "Both came in expected to advance; both went home in the opening Swiss. And nobody left winless quietly — SINNERS pushed FlyQuest to 14-16 before bowing out 0-3 alongside Gaimin Gladiators.",
        logoPickIds: [48, 95],
      },
      {
        id: "s1-fyp",
        kind: "moment",
        eyebrow: "FUCK YOUR PICK'EMS",
        headline: "Hope you didn't bank on the favorites.",
        figure: "13-2",
        figureCaption: "#81 FlyQuest buried #25 Liquid",
        body: "The chalk got shredded: Liquid (top-25) and HEROIC (#27) both crashed out, and world #81 FlyQuest did the burying on a 13-2 demolition. The single result that wrecked the most Stage I pick'ems.",
        logoPickIds: [132, 48],
      },
    ],
  },
  // Stage II (HLTV 9029) — one team turned a Major into an audit.
  106: {
    intro: {
      headline: "The bracket tightened. Eight made the Playoffs.",
      body: "Sixteen teams, eight Playoff tickets. Here's the stage that decided who plays for Cologne.",
    },
    moments: [
      {
        id: "s2-dominance-spirit-donk",
        kind: "moment",
        eyebrow: "UNTOUCHABLE",
        headline: "Spirit didn't play Stage II. They audited it.",
        figure: "10 rounds",
        figureCaption: "conceded across the entire 3-0",
        body: "Spirit gave up ten total rounds all stage (+42): 13-1 over MIBR, 13-3 and 13-1 over 9z. donk posted a 2.27 rating — the highest individual figure of the stage.",
        logoPickIds: [81],
      },
      {
        id: "s2-fut-3-0",
        kind: "moment",
        eyebrow: "NOBODY PENCILED THEM IN",
        headline: "FUT ran the table",
        figure: "3-0",
        figureCaption: "incl. a 2-1 over G2",
        body: "The team most brackets underestimated went a flawless 3-0. Krabeni took over the Ancient decider against G2 to book FUT's first-ever Stage III at an IEM Cologne Major.",
        logoPickIds: [145, 59],
      },
      {
        id: "s2-drought-astralis",
        kind: "moment",
        eyebrow: "THE DROUGHT CONTINUES",
        headline: "Astralis bow out. Again.",
        figure: "9 Majors",
        figureCaption: "paiN sweep them 2-0",
        body: "TYLOO cracked them open 13-9, then paiN finished it — Astralis collapsed on their own Nuke pick and got run off Overpass. Nine straight Majors now without reaching the Playoffs. MIBR went out the same day.",
        logoPickIds: [60, 102],
      },
      {
        id: "s2-gauntlet-deciders",
        kind: "stat",
        eyebrow: "WIN OR GO HOME",
        headline: "Three teams. Three deciders. All survived.",
        figure: "3-2",
        figureCaption: "Monte, Legacy and B8 each won a do-or-die",
        body: "The final day was a gauntlet of single-match survival. Monte upset paiN 2-0, Legacy bullied TYLOO, and B8 — 0-2 to start the stage — reverse-swept BIG, kensizor771 sealing it with an ace.",
        logoPickIds: [119, 126, 135],
      },
      {
        id: "s2-fyp",
        kind: "moment",
        eyebrow: "FUCK YOUR PICK'EMS",
        headline: "Nobody had this bracket.",
        figure: "3-0",
        figureCaption: "FUT ran it; Astralis bowed out",
        body: "The safe picks died on schedule — Astralis out for a ninth straight Major and MIBR gone — while the team nobody penciled in, FUT, went a flawless 3-0 through a stacked stage. So much for the chalk.",
        logoPickIds: [145, 60],
      },
    ],
  },
};

/** True when a stage has an authored recap (so a caller can skip work for unauthored stages). */
export function stageWrappedHasContent(sectionId: number): boolean {
  return (AUTHORED[sectionId]?.moments.length ?? 0) > 0;
}

function rankSlide(eyebrow: string, p: StageWrappedPersonal): WrappedSlide {
  const move = p.rankMove;
  let figure = "—";
  let caption = "Your spot on the board.";
  if (move && move.direction !== "new" && move.delta != null) {
    const n = Math.abs(move.delta);
    if (move.direction === "up") {
      figure = `▲${n}`;
      caption = p.rankAfter != null ? `Up to ${p.rankAfter} on the board` : "You climbed the board";
    } else if (move.direction === "down") {
      figure = `▼${n}`;
      caption = p.rankAfter != null ? `Down to ${p.rankAfter} on the board` : "You slipped this stage";
    } else {
      figure = "—";
      caption = p.rankAfter != null ? `Held at ${p.rankAfter}` : "You held your ground";
    }
  } else if (p.rankAfter != null) {
    figure = `#${p.rankAfter}`;
    caption = "Your debut on the board";
  }
  return {
    id: "personal-rank",
    kind: "standings",
    eyebrow,
    headline: "Where you landed.",
    figure,
    figureCaption: caption,
    autoAdvanceMs: AUTO_MS,
  };
}

/**
 * Build the ordered recap deck for a resolved Swiss stage.
 *
 * - Unauthored section → `[]` (the no-op; the shell shows "nothing to wrap yet"
 *   and the launcher never opens). Callers should also gate on `sectionResolved`
 *   so the deck can't leak before lock even once a stage is authored.
 * - `personal === null` (signed-out / no picks) → intro + moments + sign-in
 *   outro, with no personal slides.
 * - `personal` supplied → intro + moments + score + rank (+ best call) + outro.
 */
export function buildStageWrappedDeck(
  sectionId: number,
  stageName: string,
  personal: StageWrappedPersonal | null,
  assets: StageWrappedAssets = {},
): WrappedSlide[] {
  const authored = AUTHORED[sectionId];
  if (!authored || authored.moments.length === 0) return [];

  const eyebrow = `${stageName.toUpperCase()} · WRAPPED`;
  const numeral = stageNumeral(stageName);
  const slides: WrappedSlide[] = [];

  // Resolve 1–3 team logos for a moment; drops any that don't resolve.
  const logosFor = (pickIds?: number[]): WrappedTeamLogo[] | undefined => {
    if (!pickIds || !assets.resolveTeamLogo) return undefined;
    const resolved = pickIds
      .map((id) => assets.resolveTeamLogo!(id))
      .filter((l): l is WrappedTeamLogo => l != null);
    return resolved.length ? resolved : undefined;
  };
  const majorBrand = assets.majorLogoSrc
    ? { src: assets.majorLogoSrc, alt: "IEM Cologne 2026", invert: false }
    : undefined;
  const gameBrand = assets.gameLogoSrc
    ? { src: assets.gameLogoSrc, alt: "Counter-Strike 2", invert: false }
    : majorBrand;

  slides.push({
    id: "intro",
    kind: "intro",
    eyebrow,
    headline: authored.intro.headline,
    body: authored.intro.body,
    brandLogo: majorBrand,
    stageBadge: { numeral, label: "STAGE", sub: "WRAPPED" },
    autoAdvanceMs: AUTO_MS,
  });

  for (const m of authored.moments) {
    slides.push({
      id: m.id,
      kind: m.kind,
      eyebrow: m.eyebrow,
      headline: m.headline,
      figure: m.figure,
      figureCaption: m.figureCaption,
      body: m.body,
      teamLogos: logosFor(m.logoPickIds),
      autoAdvanceMs: AUTO_MS,
    });
  }

  if (personal) {
    const name = personal.displayName?.trim();
    slides.push({
      id: "personal-score",
      kind: "stat",
      eyebrow: "YOUR STAGE",
      headline: name ? `${name}, you scored.` : "Your stage.",
      figure: `+${personal.stagePoints}`,
      figureCaption: `${personal.correct}/${personal.resolvedSlots} calls landed · ${personal.totalPoints} total`,
      avatar: personal.avatar ?? undefined,
      autoAdvanceMs: AUTO_MS,
    });

    slides.push(rankSlide(eyebrow, personal));

    if (personal.bestCall) {
      const bc = personal.bestCall;
      const tag = bc.tag ? ` (${bc.tag})` : "";
      slides.push({
        id: "personal-best-call",
        kind: "moment",
        eyebrow: "YOUR BEST CALL",
        headline: `${bc.teamName}${tag}`,
        figure: `${bc.pct}%`,
        figureCaption: `of the field had it`,
        body: `Your sharpest read of the stage — only ${bc.count}/${bc.total} of the players who picked this slot got it right.`,
        teamLogos: logosFor([bc.pickId]),
        autoAdvanceMs: AUTO_MS,
      });
    }
  }

  slides.push({
    id: "outro",
    kind: "outro",
    eyebrow,
    headline: personal ? "On to the next one." : "See your own card.",
    body: personal
      ? "Replay this any time from the stage reveal. See you next stage."
      : "Sign in to get your personal recap — your score, your rank move, your boldest right call.",
    brandLogo: gameBrand,
    stageBadge: { numeral, label: "STAGE", sub: personal ? "DONE" : "RECAP" },
  });

  return slides;
}
