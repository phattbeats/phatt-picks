/**
 * Hotline (Major) Wrapped — app-wide auto-launch resolver (PHA-1274).
 *
 * Computes, server-side, the single-elim finale recap deck for the active
 * event. The client launcher (`StageWrappedGate`, mounted app-wide in the
 * layout) auto-opens it once the Grand Final has crowned a champion, and any
 * surface can replay it by key.
 *
 * Cost discipline: this runs in the app layout on every page, so it bails out
 * after a single playoff-scoped `stageOutcome` query when the GF hasn't
 * resolved yet.
 *
 * (The earlier per-stage auto-launcher, PHA-1051, was retired by PHA-1274 which
 * collapsed the reveal into one finale deck; its section-picker still lives in
 * `stage-wrapped-launch-core.ts` for the recap push/feed.)
 */

import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import { resolveLogoTiers } from "@/lib/logos";
import type { WrappedSlide } from "@/lib/stage-wrapped-core";
import type { StageWrappedAssets } from "@/lib/stage-wrapped-content";
import { buildPlayoffBracket, PLAYOFF_ROUNDS } from "@/lib/playoff-bracket-core";
import { isPlayoffWrapped, derivePlayoffStorylines } from "@/lib/playoff-wrapped-derive";
import { buildPlayoffWrappedDeck, COLOGNE_PLAYOFF_MOMENTS } from "@/lib/playoff-wrapped-core";

export interface StageWrappedAutoDeck {
  /** Stable per-deck id (event:major-wrapped), drives the localStorage seen-key. */
  stageKey: string;
  eventId: number;
  sectionId: number;
  /** Deck label, e.g. "Cologne Major". */
  title: string;
  slides: WrappedSlide[];
}

/** Visual assets for the deck — same logo cascade + brand marks the reveal grid uses. */
function buildWrappedAssets(teamMap: ReturnType<typeof buildTeamMap>): StageWrappedAssets {
  return {
    resolveTeamLogo: (pid: number) => {
      const t = teamMap.get(pid);
      return t ? { tiers: resolveLogoTiers(t), name: t.name } : null;
    },
    majorLogoSrc: "/watch/iem-cologne.png",
    gameLogoSrc: "/watch/counter-strike.png",
  };
}

/**
 * Shared playoff-bracket resolve. Builds the live bracket the exact way the
 * picks page does (committed playoff sections + resolved StageOutcome winners),
 * HARD-GATES on `isPlayoffWrapped`, and returns the derived finale storylines +
 * team map — or null until the Grand Final crowns a champion. Backs both the
 * Major Wrapped deck and the home "Major complete" champion hero. Cheap: one
 * playoff-scoped query, bails immediately when the GF hasn't resolved.
 */
async function resolveWrappedFacts(eventId: number): Promise<{
  teamMap: ReturnType<typeof buildTeamMap>;
  facts: ReturnType<typeof derivePlayoffStorylines>;
} | null> {
  const layout = getCommittedLayout();
  const playoffSectionIds = PLAYOFF_ROUNDS.map((r) => r.sectionId);
  const playoffSections = layout.sections.filter((s) => playoffSectionIds.includes(s.sectionid));
  if (playoffSections.length === 0) return null;

  // Cheap gate: one query scoped to the playoff sections.
  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId, sectionId: { in: playoffSectionIds } },
  });
  if (outcomes.length === 0) return null;

  const winnerByGroup = new Map<number, number>();
  for (const o of outcomes) if (o.slotIndex === 0) winnerByGroup.set(o.groupId, o.winnerPickId);

  const bracket = buildPlayoffBracket({ sections: playoffSections, winnerByGroup });
  // THE GATE: nothing until the Grand Final has a champion.
  if (!isPlayoffWrapped(bracket)) return null;

  const teamMap = buildTeamMap(layout);
  const facts = derivePlayoffStorylines(bracket, {
    nameOf: (pid: number) => teamMap.get(pid)?.name ?? null,
  });
  return { teamMap, facts };
}

/**
 * The Hotline (Major) Wrapped auto-deck (PHA-1274). Once the finale has wrapped,
 * it derives the storylines, folds in the curated historic-moment photos, and
 * builds the deck.
 *
 * v1 is the field deck (everyone sees the champion recap); the personal bracket
 * slides are a fast-follow.
 */
export async function prepareMajorWrappedAutoDeck(
  eventId: number,
  _playerId: string | null,
): Promise<StageWrappedAutoDeck | null> {
  const resolved = await resolveWrappedFacts(eventId);
  if (!resolved) return null;
  const { teamMap, facts } = resolved;

  const assets = buildWrappedAssets(teamMap);
  // Lead with the curated historic-moment photo beats (cathedral, donk, woxic,
  // the Cinderellas, magixx) rather than the seed-derived stub; the champion /
  // road / runner-up stay computed from the bracket.
  facts.moments = COLOGNE_PLAYOFF_MOMENTS;

  const slides = buildPlayoffWrappedDeck(facts, null, assets);
  if (slides.length === 0) return null;

  const gfSectionId = PLAYOFF_ROUNDS.find((r) => r.key === "GF")?.sectionId ?? 110;
  return {
    stageKey: majorWrappedStageKey(eventId),
    eventId,
    sectionId: gfSectionId,
    title: "Cologne Major",
    slides,
  };
}

/**
 * The stable `stageKey` of the Major Wrapped deck for an event — the handle the
 * replay bus uses to re-open it. The auto-launcher (`StageWrappedGate`, mounted
 * app-wide in the layout) registers under this key, so any surface can replay
 * the recap with `replayStageWrapped(majorWrappedStageKey(eventId))` instead of
 * deep-linking to a per-section reveal (which only carries that stage's own,
 * often-empty, wrap). PHA-1274.
 */
export function majorWrappedStageKey(eventId: number): string {
  return `${eventId}:major-wrapped`;
}

export interface MajorChampion {
  pickId: number;
  name: string;
  /** First logo tier for the crest (or null when none resolves). */
  logoSrc: string | null;
}

/**
 * WHO won the Major — the crowned champion, or null until the Grand Final
 * resolves. Reuses the same bracket pipeline the Wrapped deck does
 * (`resolveWrappedFacts`) so the home send-off names the exact team the recap
 * crowns. Drives the dashboard's "Major complete" hero (PHA-1274).
 */
export async function majorChampion(eventId: number): Promise<MajorChampion | null> {
  const resolved = await resolveWrappedFacts(eventId);
  if (!resolved) return null;
  const { teamMap, facts } = resolved;
  if (facts.championPickId == null) return null;

  const team = teamMap.get(facts.championPickId);
  let logoSrc: string | null = null;
  if (team) {
    for (const tier of resolveLogoTiers(team)) {
      if (tier.kind === "image") { logoSrc = tier.src; break; }
    }
  }
  return {
    pickId: facts.championPickId,
    name: facts.championName ?? team?.name ?? "the champions",
    logoSrc,
  };
}
