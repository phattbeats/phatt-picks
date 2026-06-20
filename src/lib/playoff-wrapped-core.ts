/**
 * Playoffs Wrapped — POC deck builder (PHA-1274).
 *
 * Stage Wrapped (PHA-1051/1052/1054) hands the player a Spotify-Wrapped-style
 * recap when a *Swiss* stage resolves. The Playoffs are different in shape — not
 * sixteen-team Swiss math but a single-elim bracket that ends with one team
 * lifting the trophy — so they deserve their own recap: the climax of the whole
 * Pick'Em. This module is the pure, framework-free spine of that deck. It reuses
 * the exact `WrappedSlide[]` model the existing shell (`StageWrapped.tsx`)
 * already renders, so the POC needs zero new UI — only a new source of slides.
 *
 * The recap is the *finale*, so the gate is strict: it produces an EMPTY deck
 * (the no-op the shell already understands) until the Grand Final has a winner.
 * Mid-tournament — exactly where Cologne sits as this is authored — there is no
 * champion to crown yet, so nothing fires. Once the GF resolves, the deck tells
 * the story: the champion, their road through the bracket, the bracket-buster,
 * and — for a signed-in viewer — how their own bracket called it.
 *
 * Pure + total: missing facts mean "we don't have that beat", never a throw and
 * never a fabricated team or result. `scripts/verify-playoff-wrapped.ts`
 * exercises every branch offline.
 */

import type { WrappedSlide, WrappedTeamLogo } from "./stage-wrapped-core";
import type { StageWrappedRankMove } from "./stage-wrapped-content";

/** Per-slide auto-advance for the recap (floored by the shell to MIN_AUTO_ADVANCE_MS). */
const AUTO_MS = 6000;

/**
 * Visual assets the builder can't compute itself: a team-logo resolver
 * (pickId → cascade tiers + name, from the playoff bracket's teamMap + logo
 * manifest) and the brand marks. Optional so the builder still yields a valid
 * text-only deck offline; the verify exercises both paths. Mirrors
 * `StageWrappedAssets` so the wiring layer can share one resolver.
 */
export interface PlayoffWrappedAssets {
  resolveTeamLogo?: (pickId: number) => WrappedTeamLogo | null;
  /** Major mark, e.g. "/watch/iem-cologne.png". */
  majorLogoSrc?: string;
  /** Game mark, e.g. "/watch/counter-strike.png". */
  gameLogoSrc?: string;
}

/** One leg of the champion's bracket run, in QF → SF → GF order. */
export interface PlayoffRunLeg {
  /** The team the champion beat on this leg. */
  beatPickId: number;
  round: "QF" | "SF" | "GF";
  /** Optional series score for the caption, e.g. "2-0". */
  score?: string | null;
}

/** The single bracket result that wrecked the most brackets (authored or derived). */
export interface PlayoffBracketBuster {
  /** Short eyebrow override; defaults to "BRACKET BUSTER". */
  eyebrow?: string;
  headline: string;
  body?: string;
  /** The upset winner (and, optionally, who they buried) — for the logo row. */
  winnerPickId: number;
  loserPickId?: number | null;
  /** Caption under the figure, e.g. "9z 2-1 Vitality". */
  figureCaption?: string | null;
  figure?: string | null;
}

/**
 * The hard, resolved facts of the finished bracket. The wiring layer (a sibling
 * of `stage-wrapped-launch.ts`) derives these from the committed playoff
 * sections + the live answer key; this module only assembles them into slides.
 */
export interface PlayoffWrappedFacts {
  /** The Grand Final winner's pickid — null until the GF is decided (the gate). */
  championPickId: number | null;
  championName?: string | null;
  /** The team that lost the Grand Final, for the "lifted the trophy over X" beat. */
  runnerUpPickId?: number | null;
  runnerUpName?: string | null;
  /** Series score of the Grand Final, e.g. "3-1". */
  finalScore?: string | null;
  /** The champion's path, QF → GF. Drives the "THE RUN" slide when present. */
  championPath?: PlayoffRunLeg[];
  /** The marquee upset of the bracket, when there is one. */
  bracketBuster?: PlayoffBracketBuster | null;
  /** Total bracket matches (QF+SF+GF) and how many are decided — for honesty copy. */
  totalMatches: number;
  decidedMatches: number;
}

/** The viewer's bracket performance, assembled by the caller from picks + outcomes. */
export interface PlayoffWrappedPersonal {
  displayName?: string | null;
  avatar?: { src: string | null; label: string } | null;
  /** Bracket matches the viewer called correctly. */
  bracketHits: number;
  /** Bracket matches the viewer picked that have since resolved. */
  bracketResolved: number;
  /** Who the viewer crowned champion (their Grand Final pick), or null. */
  championPickId: number | null;
  championName?: string | null;
  /** Final leaderboard rank after the playoffs, 1-based, or null if unranked. */
  rankAfter?: number | null;
  rankMove?: StageWrappedRankMove | null;
  /** Reaction stamps the viewer dropped on the bracket (The Bleachers), if any. */
  reactionsPlaced?: number | null;
}

/** True once the bracket has a champion — i.e. a Playoffs Wrapped deck exists. */
export function playoffWrappedHasContent(facts: Pick<PlayoffWrappedFacts, "championPickId">): boolean {
  return facts.championPickId != null && facts.championPickId !== 0;
}

const ROUND_WORD: Record<PlayoffRunLeg["round"], string> = {
  QF: "the Quarterfinal",
  SF: "the Semifinal",
  GF: "the Grand Final",
};

/** Resolve a team's display name from facts/personal, falling back to "#<id>". */
function nameFor(pickId: number, assets: PlayoffWrappedAssets, fallback?: string | null): string {
  return assets.resolveTeamLogo?.(pickId)?.name ?? fallback ?? `#${pickId}`;
}

/**
 * Build the ordered Playoffs Wrapped deck.
 *
 * - No champion yet (`championPickId` null/0) → `[]` (the no-op; the shell shows
 *   its honest "nothing to wrap yet" card and the launcher never auto-opens).
 * - `personal === null` (signed-out / no bracket) → cover + champion + run +
 *   buster + sign-in outro, with no personal slides.
 * - `personal` supplied → also the viewer's bracket score, their crowned
 *   champion (with a "YOU CALLED THE CHAMPION" reward when it matched), and rank.
 */
export function buildPlayoffWrappedDeck(
  facts: PlayoffWrappedFacts,
  personal: PlayoffWrappedPersonal | null,
  assets: PlayoffWrappedAssets = {},
): WrappedSlide[] {
  if (!playoffWrappedHasContent(facts)) return [];
  const champId = facts.championPickId as number;

  const slides: WrappedSlide[] = [];
  const eyebrow = "COLOGNE PLAYOFFS · WRAPPED";

  const logo = (pickId: number | null | undefined): WrappedTeamLogo[] | undefined => {
    if (pickId == null || pickId === 0 || !assets.resolveTeamLogo) return undefined;
    const l = assets.resolveTeamLogo(pickId);
    return l ? [l] : undefined;
  };
  const logoRow = (...pickIds: Array<number | null | undefined>): WrappedTeamLogo[] | undefined => {
    if (!assets.resolveTeamLogo) return undefined;
    const row = pickIds
      .filter((id): id is number => id != null && id !== 0)
      .map((id) => assets.resolveTeamLogo!(id))
      .filter((l): l is WrappedTeamLogo => l != null);
    return row.length ? row : undefined;
  };

  const majorBrand = assets.majorLogoSrc
    ? { src: assets.majorLogoSrc, alt: "IEM Cologne 2026", invert: false }
    : undefined;
  const gameBrand = assets.gameLogoSrc
    ? { src: assets.gameLogoSrc, alt: "Counter-Strike 2", invert: false }
    : majorBrand;

  const championName = nameFor(champId, assets, facts.championName);

  // 1 — Cover.
  slides.push({
    id: "po-intro",
    kind: "intro",
    eyebrow,
    headline: "Eight walked in. One walked out.",
    body: "The Cathedral named its champion. Before you see how you called it — here's how the Cologne Playoffs went down.",
    brandLogo: majorBrand,
    stageBadge: { numeral: "PLAYOFFS", label: "COLOGNE", sub: "WRAPPED" },
    autoAdvanceMs: AUTO_MS,
  });

  // 2 — The champion.
  const overRunnerUp =
    facts.runnerUpPickId && facts.runnerUpPickId !== 0
      ? ` over ${nameFor(facts.runnerUpPickId, assets, facts.runnerUpName)}`
      : "";
  const finalScore = facts.finalScore?.trim();
  slides.push({
    id: "po-champion",
    kind: "moment",
    eyebrow: "CHAMPION OF COLOGNE",
    headline: `${championName} lifted the trophy.`,
    figure: "🏆",
    figureCaption: finalScore
      ? `Grand Final${overRunnerUp} · ${finalScore}`
      : overRunnerUp
        ? `Grand Final${overRunnerUp}`.trim()
        : "Champions of IEM Cologne 2026",
    body: `Eight teams entered the single-elim bracket. ${championName} ran the table${overRunnerUp} to be the last team standing in the Cathedral of Counter-Strike.`,
    teamLogos: logo(champId),
    autoAdvanceMs: AUTO_MS,
  });

  // 3 — The champion's run (only when we have the path).
  const path = facts.championPath ?? [];
  if (path.length > 0) {
    const legs = path
      .map((leg) => {
        const beat = nameFor(leg.beatPickId, assets);
        const sc = leg.score?.trim() ? ` ${leg.score.trim()}` : "";
        return `${ROUND_WORD[leg.round]}: ${beat}${sc}`;
      })
      .join(" · ");
    slides.push({
      id: "po-run",
      kind: "moment",
      eyebrow: "THE RUN",
      headline: `${championName}'s road to the trophy`,
      figure: `${path.length}-0`,
      figureCaption: "series dropped on the way to the title",
      body: legs,
      teamLogos: logoRow(...path.map((l) => l.beatPickId)),
      autoAdvanceMs: AUTO_MS,
    });
  }

  // 4 — The bracket-buster (only when authored/derived).
  if (facts.bracketBuster) {
    const b = facts.bracketBuster;
    slides.push({
      id: "po-buster",
      kind: "moment",
      eyebrow: b.eyebrow ?? "BRACKET BUSTER",
      headline: b.headline,
      figure: b.figure ?? undefined,
      figureCaption: b.figureCaption ?? undefined,
      body: b.body,
      teamLogos: logoRow(b.winnerPickId, b.loserPickId),
      autoAdvanceMs: AUTO_MS,
    });
  }

  // 5+ — Personal slides (signed-in viewer with a bracket).
  if (personal) {
    const name = personal.displayName?.trim();
    slides.push({
      id: "po-your-bracket",
      kind: "stat",
      eyebrow: "YOUR BRACKET",
      headline: name ? `${name}, your bracket.` : "Your bracket.",
      figure: `${personal.bracketHits}/${personal.bracketResolved}`,
      figureCaption: "bracket calls landed",
      avatar: personal.avatar ?? undefined,
      autoAdvanceMs: AUTO_MS,
    });

    // Your champion — matched the real one or not.
    if (personal.championPickId && personal.championPickId !== 0) {
      const yourChampName = nameFor(personal.championPickId, assets, personal.championName);
      const matched = personal.championPickId === champId;
      slides.push({
        id: "po-your-champion",
        kind: "moment",
        eyebrow: "YOUR CHAMPION",
        headline: matched ? `You crowned ${yourChampName}.` : `You had ${yourChampName}.`,
        figure: matched ? "✓" : undefined,
        body: matched
          ? `You called the Cathedral right — ${yourChampName} lifted the trophy exactly like you said.`
          : `Your title pick was ${yourChampName}; the bracket crowned ${championName}. Next Major.`,
        teamLogos: logo(personal.championPickId),
        calledIt: matched
          ? { label: "YOU CALLED THE CHAMPION", sub: "You saw the vision." }
          : undefined,
        autoAdvanceMs: AUTO_MS,
      });
    }

    // The Bleachers — your reactions on the bracket (only when you dropped any).
    if (personal.reactionsPlaced && personal.reactionsPlaced > 0) {
      slides.push({
        id: "po-bleachers",
        kind: "stat",
        eyebrow: "THE BLEACHERS",
        headline: "You were in the building.",
        figure: `${personal.reactionsPlaced}`,
        figureCaption: personal.reactionsPlaced === 1 ? "reaction dropped on the bracket" : "reactions dropped on the bracket",
        body: "Your stamps landed on the picks you backed — unmasked now that the bracket's resolved.",
        autoAdvanceMs: AUTO_MS,
      });
    }

    // Where you landed.
    slides.push(rankSlide(eyebrow, personal));
  }

  // Closer.
  slides.push({
    id: "po-outro",
    kind: "outro",
    eyebrow,
    headline: personal ? "Cologne is a wrap." : "See your own card.",
    body: personal
      ? "That's the Major. Replay this any time from the bracket. See you in Singapore."
      : "Sign in to get your personal bracket recap — your calls, your champion, your rank.",
    brandLogo: gameBrand,
    stageBadge: { numeral: "PLAYOFFS", label: "COLOGNE", sub: personal ? "CHAMPIONS" : "RECAP" },
  });

  return slides;
}

/** "Where you landed" — final leaderboard rank + movement. Mirrors the stage deck. */
function rankSlide(eyebrow: string, p: PlayoffWrappedPersonal): WrappedSlide {
  const move = p.rankMove;
  let figure = "—";
  let caption = "Your final spot on the board.";
  if (move && move.direction !== "new" && move.delta != null) {
    const n = Math.abs(move.delta);
    if (move.direction === "up") {
      figure = `▲${n}`;
      caption = p.rankAfter != null ? `Up to ${p.rankAfter} on the final board` : "You climbed the board";
    } else if (move.direction === "down") {
      figure = `▼${n}`;
      caption = p.rankAfter != null ? `Down to ${p.rankAfter} on the final board` : "You slipped at the finish";
    } else {
      figure = "—";
      caption = p.rankAfter != null ? `Held at ${p.rankAfter}` : "You held your ground";
    }
  } else if (p.rankAfter != null) {
    figure = `#${p.rankAfter}`;
    caption = "Your final spot on the board";
  }
  return {
    id: "po-rank",
    kind: "standings",
    eyebrow,
    headline: "Where you finished.",
    figure,
    figureCaption: caption,
    autoAdvanceMs: AUTO_MS,
  };
}
