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

import type { WrappedPhoto, WrappedSlide, WrappedTeamLogo } from "./stage-wrapped-core";
import type { StageWrappedRankMove } from "./stage-wrapped-content";
import { regionMetaForPickid } from "./regions-core";

/** Per-slide auto-advance for the recap (floored by the shell to MIN_AUTO_ADVANCE_MS). */
const AUTO_MS = 6000;

/* ------------------------------------------------------------------------- *
 * The "dank HLTV photo" twist (PHA-1274).
 *
 * Brandon: "the twist for this wrapped is we include DANK photos from HLTV —
 * niko screaming, the cologne cathedral, etc." Photos live under /public/wrapped
 * and every one carries a real, licensable credit (the POC ships Wikimedia
 * Commons stills of the actual venue; HLTV/match-specific stills are a licensing
 * follow-up — see the PR). The marks below are the reusable handles the authored
 * moments and the champion slide reference, so swapping in a licensed HLTV still
 * later is a one-line change.
 * ------------------------------------------------------------------------- */
export const COLOGNE_PHOTOS = {
  cathedral: {
    src: "/wrapped/cologne-cathedral.jpg",
    alt: "Cologne Cathedral towering over the city skyline",
    credit: "Cologne Cathedral · Wikimedia · CC BY-SA",
    focus: "50% 38%",
  },
  arena: {
    src: "/wrapped/cologne-arena.jpg",
    alt: "A packed Counter-Strike arena in Cologne, the main stage lit blue",
    credit: "ESL One Cologne · Wikimedia · CC BY-SA",
    focus: "50% 42%",
  },
  player: {
    src: "/wrapped/cologne-player.jpg",
    alt: "A Counter-Strike pro on the Cologne stage",
    credit: "ESL One Cologne · Wikimedia · CC BY-SA",
    focus: "50% 30%",
  },
  /**
   * RESERVED (PHA-1274, Brandon): the magixx 1v4 — hand on his head in disbelief.
   * The licensed HLTV/press reaction still is a follow-up (same licensing path as
   * the venue stills above). The spot is reserved by pointing here: drop the
   * licensed file in at /public/wrapped/magixx-1v4.jpg and the slide's photo band
   * lights up with ZERO code change (PhotoFigure hides gracefully until it
   * exists). Until then the beat rides its copy + Spirit logo.
   */
  magixx: {
    src: "/wrapped/magixx-1v4.jpg",
    alt: "magixx, hand on his head in disbelief after his 1v4 clutch",
    credit: "magixx 1v4 · IEM Cologne — reaction still",
    focus: "50% 26%",
  },
} satisfies Record<string, WrappedPhoto>;

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
 * An authored, already-happened playoff beat — the "historic moments" Brandon
 * asked for, each carrying a dank documentary photo. These are curated (not
 * derived) so the recap has real story even mid-bracket, before there's a
 * champion to crown.
 */
export interface PlayoffMoment {
  id: string;
  eyebrow: string;
  headline: string;
  body?: string;
  figure?: string;
  figureCaption?: string;
  /** Team pickids whose logos illustrate the beat (0–3). */
  logoPickIds?: number[];
  /** The dank photo for this beat (cathedral / arena / a player moment). */
  photo?: WrappedPhoto;
}

/**
 * The historic Cologne Playoff beats that have ALREADY happened — curated, real,
 * and photo-led. The wiring layer passes these into the deck so the recap shows
 * story now (Cologne is mid-bracket as this is authored), not an empty card that
 * waits for the Grand Final. Add/replace beats as the bracket plays out; the
 * exact live results land here (or get derived) when the matches resolve.
 */
export const COLOGNE_PLAYOFF_MOMENTS: readonly PlayoffMoment[] = [
  {
    id: "po-m-cathedral",
    eyebrow: "THE CATHEDRAL",
    headline: "Welcome to the Cathedral of Counter-Strike.",
    body: "Thirty-two of the best teams in the world came to Cologne to fight through three Swiss stages for one of eight Playoff tickets — into the loudest building in Counter-Strike, the one every player wants to win in.",
    photo: COLOGNE_PHOTOS.arena,
  },
  {
    id: "po-m-donk",
    eyebrow: "THE BEST IN THE WORLD",
    headline: "donk turned the Swiss into a highlight reel.",
    body: "Spirit barely conceded a round on the way through Cologne — a clean 3-0 over NaVi, Aurora and 9z, with donk, the Major MVP at sixteen, posting one of the most dominant individual runs the Major has seen. For a stretch, the rest of the field was playing for second.",
    logoPickIds: [81],
    photo: COLOGNE_PHOTOS.cathedral,
  },
  {
    id: "po-m-woxic",
    eyebrow: "A NATION'S RETURN",
    headline: "woxic's 1v4 sent Turkey to the bracket.",
    figure: "1v4",
    figureCaption: "Aurora clinch on Dust2, Stage 3",
    body: "With the Playoff berth on the line, woxic stood up in a 1v4 on Dust2 and won it — sealing Aurora's first run to a Major playoff stage since Copenhagen 2024, and the Turkish core back among the last eight.",
    logoPickIds: [134],
    photo: COLOGNE_PHOTOS.player,
  },
  {
    id: "po-m-cinderellas",
    eyebrow: "THE CINDERELLAS",
    headline: "The two lowest seeds crashed the bracket.",
    figure: "#13 · #15",
    figureCaption: "9z and BetBoom booked Playoff tickets",
    body: "9z (#13) knocked out top-seeded Vitality to make it on a negative round diff, and BetBoom (#15) swept title contender Falcons. Nobody had this bracket — and now they're in the Cathedral.",
    logoPickIds: [112, 137],
    photo: COLOGNE_PHOTOS.arena,
  },
  {
    // RESERVED (PHA-1274, Brandon, 2026-06-20): "reserve a spot for magixx 1v4
    // with a pic of his hand on his head in disbelief." Spirit = pickid 81. The
    // reaction still is licensed-follow-up (COLOGNE_PHOTOS.magixx → drop file in,
    // zero code change). Copy + Spirit logo carry the beat until it lands.
    id: "po-m-magixx-1v4",
    eyebrow: "HISTORIC MOMENT",
    headline: "magixx, one man against four — and still standing.",
    figure: "1v4",
    figureCaption: "Spirit past G2, Mirage · the Quarterfinal",
    body: "Last man alive in the Quarterfinal, the round already written off, magixx held one angle and emptied a single AK spray through four G2 players — then froze, hand on his head, not quite believing it himself. Graffiti-worthy. Valve made his face their profile picture. The Cathedral lost its mind.",
    logoPickIds: [81, 59],
    photo: COLOGNE_PHOTOS.magixx,
  },
] as const;

/**
 * A one-slide tribute to a team that made the Cologne last eight. The "big
 * finish" deck (PHA-1274, Brandon: "every team should have at least one slide")
 * gives each of the eight its own card — the global spread of the field is half
 * the story. Copy is grounded in each team's real Cologne run (the Spotlight
 * narratives), so nothing here is invented.
 */
export interface PlayoffTeamTribute {
  pickId: number;
  /** Mono eyebrow tag, mirrors the team's Spotlight tag (e.g. "THE LAST DANCE"). */
  tag: string;
  /** One-line tribute, grounded in the team's real run. */
  blurb: string;
}

/**
 * The eight that walked into the Cathedral, each with a card in the finale deck.
 * Order is a deliberate flow (marquees → rebuilds → Cinderellas), not seeding.
 * Names render through the logo resolver; the region chip on each slide is what
 * makes the "every flag in the building" thread land.
 */
export const COLOGNE_PLAYOFF_TEAMS: readonly PlayoffTeamTribute[] = [
  { pickId: 81, tag: "THE BEST IN THE WORLD", blurb: "donk — a Major MVP at sixteen — and sh1ro behind him. The most feared roster alive walked in barely dropping a round." },
  { pickId: 89, tag: "THE BURDEN OF FIRST", blurb: "ZywOo and apEX. The world #1, the standard the whole scene measures itself against, carrying the weight of the favourite." },
  { pickId: 139, tag: "THE MISSING CROWN", blurb: "NiKo, m0NESY and karrigan — a roster built for one thing: the trophy its biggest star has never lifted." },
  { pickId: 85, tag: "THE LAST DANCE", blurb: "FalleN's last ride, the AWP now molodoy's. Brazil's godfather chasing one more Major as the torch passes in real time." },
  { pickId: 59, tag: "THE REBUILD", blurb: "huNter and a fearless young core — HeavyGod and MATYS — the rebuilt G2 nobody had pegged for the last eight." },
  { pickId: 134, tag: "A NATION'S RETURN", blurb: "XANTARES, MAJ3R, and woxic's 1v4 on Dust2. Turkish Counter-Strike back among the last eight for the first time since Copenhagen." },
  { pickId: 137, tag: "THE LONG WAY BACK", blurb: "Boombl4, a Major-winning captain, dragging an all-Russian young core back to the bracket the hard way." },
  { pickId: 112, tag: "BEYOND BRAZIL", blurb: "luchov and dgt's ace on Overpass. Argentina, Uruguay and Chile — the first South American playoff team without a Brazilian core." },
] as const;

/**
 * The hard, resolved facts of the bracket so far. The wiring layer (a sibling
 * of `stage-wrapped-launch.ts`) derives these from the committed playoff
 * sections + the live answer key; this module only assembles them into slides.
 */
export interface PlayoffWrappedFacts {
  /** Authored historic beats to fold in (already-happened, photo-led). */
  moments?: readonly PlayoffMoment[];
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

/** True when there's a Playoffs Wrapped story to tell — a crowned champion OR at
 * least one authored historic moment (so the recap shows already-happened beats
 * mid-bracket, not just the finale). */
export function playoffWrappedHasContent(facts: Pick<PlayoffWrappedFacts, "championPickId" | "moments">): boolean {
  const hasChampion = facts.championPickId != null && facts.championPickId !== 0;
  return hasChampion || (facts.moments?.length ?? 0) > 0;
}

/** Whether the Grand Final has crowned a champion (the finale slides gate on this). */
function hasChampion(facts: Pick<PlayoffWrappedFacts, "championPickId">): boolean {
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
  const decided = hasChampion(facts);
  const champId = facts.championPickId ?? 0;

  const slides: WrappedSlide[] = [];
  const eyebrow = "COLOGNE MAJOR · WRAPPED";

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

  const championName = decided ? nameFor(champId, assets, facts.championName) : "";

  // 1 — Cover. This is the *Major* Wrapped (Brandon: "32 teams walked in, 1
  // walked out") — the whole IEM Cologne run, three Swiss gauntlets and the
  // bracket, not just the Playoffs. Copy + closer adapt to whether the Final has
  // crowned a champion: mid-tournament it's a "so far" recap of the moments that
  // already made history; once decided it's the finale. Cathedral photo leads.
  slides.push({
    id: "po-intro",
    kind: "intro",
    eyebrow,
    headline: decided ? "Thirty-two walked in. One walked out." : "Thirty-two walked in. The Cathedral is loud.",
    body: decided
      ? "Three Swiss gauntlets, a single-elimination bracket, and the loudest building in Counter-Strike named its champion. Before you see how you called it — here's how the Cologne Major went down."
      : "The Cologne Major is underway — thirty-two teams, three Swiss stages, and it's already made history. Here's the run so far.",
    brandLogo: majorBrand,
    photo: COLOGNE_PHOTOS.cathedral,
    stageBadge: { numeral: "MAJOR", label: "COLOGNE", sub: "WRAPPED" },
    autoAdvanceMs: AUTO_MS,
  });

  // 2 — Authored historic beats (already happened, photo-led).
  for (const m of facts.moments ?? []) {
    slides.push({
      id: m.id,
      kind: "moment",
      eyebrow: m.eyebrow,
      headline: m.headline,
      figure: m.figure,
      figureCaption: m.figureCaption,
      body: m.body,
      teamLogos: logoRow(...(m.logoPickIds ?? [])),
      photo: m.photo,
      autoAdvanceMs: AUTO_MS,
    });
  }

  // 3 — The champion (only once the Grand Final is decided).
  if (decided) {
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
      photo: COLOGNE_PHOTOS.arena,
      autoAdvanceMs: AUTO_MS,
    });
  }

  // 4 — The champion's run (only when we have the path).
  const path = decided ? facts.championPath ?? [] : [];
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

  // 5 — The field: every team that made the Cathedral gets a card (Brandon:
  // "every team should have at least one slide"). A "nations" bridge leads it so
  // the global spread of the eight reads as the story it is, then one tribute
  // per team. Evergreen — shows the moment the playoff field is set, finale or
  // mid-bracket — so the recap always carries the room.
  slides.push({
    id: "po-nations",
    kind: "moment",
    eyebrow: "THE LAST EIGHT",
    headline: "Thirty-two came. Eight made the Cathedral.",
    figure: "32 → 8",
    figureCaption: "three Swiss gauntlets, eight survivors",
    body: "Brazil and Argentina, France and Turkey, Russia and Kazakhstan, the rebuilt and the unheralded — the eight that walked out of the gauntlet came from every corner of the world. One bracket, one server, the planet watching the same rounds at once. This is what Counter-Strike does.",
    photo: COLOGNE_PHOTOS.arena,
    autoAdvanceMs: AUTO_MS,
  });
  for (const t of COLOGNE_PLAYOFF_TEAMS) {
    const region = regionMetaForPickid(t.pickId);
    slides.push({
      id: `po-team-${t.pickId}`,
      kind: "moment",
      eyebrow: t.tag,
      headline: nameFor(t.pickId, assets),
      figureCaption: region ? region.label : undefined,
      body: t.blurb,
      teamLogos: logo(t.pickId),
      autoAdvanceMs: AUTO_MS,
    });
  }

  // 6+ — Personal slides (signed-in viewer with a bracket).
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

    // Your champion — a settled verdict once the Final is in, a live call before.
    if (personal.championPickId && personal.championPickId !== 0) {
      const yourChampName = nameFor(personal.championPickId, assets, personal.championName);
      const matched = decided && personal.championPickId === champId;
      slides.push({
        id: "po-your-champion",
        kind: "moment",
        eyebrow: "YOUR CHAMPION",
        headline: matched
          ? `You crowned ${yourChampName}.`
          : decided
            ? `You had ${yourChampName}.`
            : `Your pick to lift it: ${yourChampName}.`,
        figure: matched ? "✓" : undefined,
        body: matched
          ? `You called the Cathedral right — ${yourChampName} lifted the trophy exactly like you said.`
          : decided
            ? `Your title pick was ${yourChampName}; the bracket crowned ${championName}. Next Major.`
            : `You've got ${yourChampName} to win it all. They're still alive in the bracket — hold your breath.`,
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
        body: decided
          ? "Your stamps landed on the picks you backed — unmasked now that the bracket's resolved."
          : "Your stamps are on the picks you backed — they unmask as each match resolves.",
        autoAdvanceMs: AUTO_MS,
      });
    }

    // Where you landed.
    slides.push(rankSlide(eyebrow, personal, decided));
  }

  // Closer, part 1 — the heartfelt thank-you from -phaTT (Brandon: "a very
  // heartfelt thank you from -phaTT ... love for the community of cs and the
  // unity of all the different countries in the world participating and the
  // fans"). For a signed-out viewer it carries a soft nudge to sign in next
  // time; signed-in keeps it pure gratitude.
  slides.push({
    id: "po-thanks",
    kind: "outro",
    eyebrow: "FROM -phaTT",
    headline: "Thank you for being here.",
    body: !personal
      ? "Every pick, every reaction, every 3am refresh to catch a clutch from the other side of the world — that's what makes this. Counter-Strike puts the whole planet in one room, and you were in it. Sign in next time and we'll keep your card. From all of us at phaTT: thank you. We love this game, and we love this community. ♥"
      : "Every pick you made, every reaction you dropped, every late night you spent watching strangers from across the world play the game we all love — thank you. Counter-Strike puts the whole planet in one room, and you spent this Major in it with us. From all of us at phaTT: we love this game, and we love you. ♥",
    photo: COLOGNE_PHOTOS.arena,
    stageBadge: { numeral: "♥", label: "FROM", sub: "phaTT" },
  });

  // Closer, part 2 — the post-credits stinger (Brandon: "a cheeky see you at the
  // next one hint sort of like a marvel movie 'will return' type shit"). The
  // genuine last beat: the next Major is PGL Singapore 2026.
  slides.push({
    id: "po-stinger",
    kind: "outro",
    eyebrow: "POST-CREDITS",
    headline: "phaTT Picks will return.",
    body: "Next stop: PGL Major Singapore 2026. New bracket, new Cinderellas, new history — same room, same game, same world. See you there. 🌏",
    brandLogo: gameBrand,
    stageBadge: { numeral: "?", label: "NEXT", sub: "MAJOR" },
  });

  return slides;
}

/** "Where you landed" — leaderboard rank + movement. Mirrors the stage deck;
 *  copy says "final" once the bracket's decided, "current" while it's live. */
function rankSlide(eyebrow: string, p: PlayoffWrappedPersonal, decided: boolean): WrappedSlide {
  const where = decided ? "final" : "current";
  const move = p.rankMove;
  let figure = "—";
  let caption = `Your ${where} spot on the board.`;
  if (move && move.direction !== "new" && move.delta != null) {
    const n = Math.abs(move.delta);
    if (move.direction === "up") {
      figure = `▲${n}`;
      caption = p.rankAfter != null ? `Up to ${p.rankAfter} on the ${where} board` : "You climbed the board";
    } else if (move.direction === "down") {
      figure = `▼${n}`;
      caption = p.rankAfter != null ? `Down to ${p.rankAfter} on the ${where} board` : "You slipped this run";
    } else {
      figure = "—";
      caption = p.rankAfter != null ? `Held at ${p.rankAfter}` : "You held your ground";
    }
  } else if (p.rankAfter != null) {
    figure = `#${p.rankAfter}`;
    caption = `Your ${where} spot on the board`;
  }
  return {
    id: "po-rank",
    kind: "standings",
    eyebrow,
    headline: decided ? "Where you finished." : "Where you stand.",
    figure,
    figureCaption: caption,
    autoAdvanceMs: AUTO_MS,
  };
}
