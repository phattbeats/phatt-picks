/**
 * Stage Wrapped — app-wide auto-launch resolver (PHA-1051).
 *
 * The reveal page (`/reveal/[section]`) mounts the Stage Wrapped popup, but that
 * only fires once a viewer actually navigates to that page. Brandon wants the
 * recap to "bug all users with a popup when they sign in after a stage goes
 * live" — i.e. it must auto-open app-wide on sign-in, the same way the
 * How-To-Play modal does (mounted in `(app)/layout.tsx`).
 *
 * This module computes, server-side, the deck for the *latest resolved &
 * authored* stage, personalized to the viewer. The client launcher
 * (`StageWrappedAnnounce`) then auto-opens it once per stage (localStorage),
 * so the popup nags each signed-in user exactly once per stage on any page.
 *
 * Cost discipline: this runs in the app layout on every page, so it bails out
 * after a single `stageOutcome` query when no authored stage has resolved yet.
 * Only when there *is* a stage to wrap does it load the viewer's picks + score.
 */

import { prisma } from "@/lib/db";
import { getCommittedLayout, buildTeamMap } from "@/lib/layout";
import type { Section } from "@/lib/layout";
import { scorePlayer, type PlayerPickMap, type OutcomeMap } from "@/lib/scoring";
import { resolveLogoTiers } from "@/lib/logos";
import { bucketSwissSlots, isSwissSection, resolveBucketWinners } from "@/lib/swiss-bucket-core";
import { rankMapForSection, snapshotSectionIds } from "@/lib/rank-snapshot";
import { previousResolvedSection, rankDelta } from "@/lib/rank-snapshot-core";
import { buildConsensus, consensusKey, shareFor } from "@/lib/consensus-core";
import { stageWrappedKey, type WrappedSlide } from "@/lib/stage-wrapped-core";
import {
  buildStageWrappedDeck,
  type StageWrappedAssets,
  type StageWrappedBestCall,
  type StageWrappedPersonal,
} from "@/lib/stage-wrapped-content";
import { latestWrappedSectionId } from "@/lib/stage-wrapped-launch-core";
import { buildPlayoffBracket, PLAYOFF_ROUNDS } from "@/lib/playoff-bracket-core";
import { isPlayoffWrapped, derivePlayoffStorylines } from "@/lib/playoff-wrapped-derive";
import { buildPlayoffWrappedDeck, COLOGNE_PLAYOFF_MOMENTS } from "@/lib/playoff-wrapped-core";

export interface StageWrappedAutoDeck {
  /** Stable per-stage id (event:section), drives the localStorage seen-key. */
  stageKey: string;
  eventId: number;
  sectionId: number;
  /** Stage label, e.g. "Stage III". */
  title: string;
  slides: WrappedSlide[];
}

/** Short pick-type tag for a Swiss slot (3:0 / 3:1·3:2 / 0:3). Mirrors reveal. */
function bucketLabelFor(sectionId: number, group: Section["groups"][number], slotIndex: number): string | null {
  if (!isSwissSection(sectionId)) return null;
  const buckets = bucketSwissSlots(group.picks.length);
  const hit = buckets.find((b) => b.slotIndexes.includes(slotIndex));
  if (!hit || hit.label === "PICKS") return null;
  return hit.label.replace(" ADVANCED", "").replace(" ELIMINATED", "");
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
 * Resolve the auto-launch deck for the latest resolved+authored stage.
 *
 * @param eventId  active event id (per-request, from `currentEventId()`)
 * @param playerId signed-in viewer, or null for the field-only deck
 * @returns the deck (with personal slides when `playerId` is set) or null when
 *          there is no stage to wrap yet.
 */
export async function prepareStageWrappedAutoDeck(
  eventId: number,
  playerId: string | null,
): Promise<StageWrappedAutoDeck | null> {
  const layout = getCommittedLayout();

  // Cheap gate: one query. If no authored stage has resolved, do nothing more.
  const outcomes = await prisma.stageOutcome.findMany({ where: { eventId } });
  if (outcomes.length === 0) return null;

  const outcomeMap: OutcomeMap = {};
  for (const o of outcomes) {
    outcomeMap[o.sectionId] ??= {};
    outcomeMap[o.sectionId][o.groupId] ??= {};
    outcomeMap[o.sectionId][o.groupId][o.slotIndex] = o.winnerPickId;
  }

  const sectionId = latestWrappedSectionId(layout, outcomeMap);
  if (sectionId == null) return null;

  const sectionDef = layout.sections.find((s) => s.sectionid === sectionId);
  if (!sectionDef) return null;

  const teamMap = buildTeamMap(layout);
  const wrappedAssets = buildWrappedAssets(teamMap);
  const stageLabel = sectionDef.name.split(" | ")[0];
  const stageKey = stageWrappedKey(eventId, sectionId);

  // Field-wide pick distribution for THIS stage (post-lock by construction —
  // the stage is resolved). Feeds the "best call" share + "YOU CALLED IT" reward.
  const allPicks = await prisma.pick.findMany({
    where: { eventId, sectionId },
    select: { playerId: true, sectionId: true, groupId: true, slotIndex: true, pickId: true },
  });
  const slotConsensus = buildConsensus(allPicks);

  const subject = playerId
    ? await prisma.player.findUnique({ where: { id: playerId } })
    : null;

  // Signed-out / unknown viewer → field-only deck (no personal slides).
  if (!subject) {
    const slides = buildStageWrappedDeck(sectionId, stageLabel, null, wrappedAssets);
    return slides.length ? { stageKey, eventId, sectionId, title: stageLabel, slides } : null;
  }

  // Personal deck: score this stage + cumulative, rank move, and best call.
  const subjectPicks = await prisma.pick.findMany({ where: { eventId, playerId: subject.id } });
  const subjectPickMap: PlayerPickMap[string] = {};
  for (const p of subjectPicks) {
    subjectPickMap[p.sectionId] ??= {};
    subjectPickMap[p.sectionId][p.groupId] ??= {};
    subjectPickMap[p.sectionId][p.groupId][p.slotIndex] = p.pickId;
  }

  const stageOutcomes: OutcomeMap = outcomeMap[sectionId] ? { [sectionId]: outcomeMap[sectionId] } : {};
  const stageBreak = scorePlayer(layout, subjectPickMap, stageOutcomes).bySection.find((b) => b.sectionId === sectionId);
  const stagePoints = stageBreak?.points ?? 0;
  const correct = stageBreak?.correct ?? 0;
  const totalPoints = scorePlayer(layout, subjectPickMap, outcomeMap).total;

  let resolvedSlots = 0;
  for (const g of sectionDef.groups) {
    const gOut = outcomeMap[sectionId]?.[g.groupid] ?? {};
    for (const slot of g.picks) if (gOut[slot.index] !== undefined) resolvedSlots++;
  }

  // Rank before/after this stage from the frozen snapshots.
  const resolvedSections = await snapshotSectionIds(eventId);
  const prevSection = previousResolvedSection(resolvedSections, sectionId);
  const [afterMap, beforeMap] = await Promise.all([
    rankMapForSection(eventId, sectionId),
    rankMapForSection(eventId, prevSection),
  ]);
  const rankAfter = afterMap.get(subject.id) ?? null;
  const rankBefore = beforeMap.get(subject.id) ?? null;
  const delta = rankAfter != null ? rankDelta(rankAfter, rankBefore) : null;

  // Best call + claimed narrative outcomes — identical logic to the reveal page
  // so the recap agrees with the per-pick breakdown there.
  let bestCall: StageWrappedBestCall | null = null;
  const viewerClaims = new Set<string>();
  for (const group of sectionDef.groups) {
    const gOut = outcomeMap[sectionId]?.[group.groupid] ?? {};
    const buckets = isSwissSection(sectionId) ? bucketSwissSlots(group.picks.length) : null;
    for (const slot of group.picks) {
      const pickId = subjectPickMap[sectionId]?.[group.groupid]?.[slot.index];
      if (pickId == null || pickId === 0) continue;
      const winner = gOut[slot.index];
      if (winner === undefined) continue;
      const bucket = buckets?.find((b) => b.slotIndexes.includes(slot.index)) ?? null;
      const isCorrect = bucket
        ? resolveBucketWinners(bucket.slotIndexes, gOut).winners.has(pickId)
        : pickId === winner;
      if (!isCorrect) continue;
      const claimTag = bucketLabelFor(sectionId, group, slot.index);
      if (claimTag) viewerClaims.add(`${pickId}:${claimTag}`);
      const share = shareFor(slotConsensus, sectionId, group.groupid, slot.index, pickId);
      const pct = share?.pct ?? 0;
      const count = share?.count ?? 0;
      const total = slotConsensus.get(consensusKey(sectionId, group.groupid, slot.index))?.total ?? 0;
      if (bestCall === null || pct < bestCall.pct) {
        bestCall = {
          pickId,
          teamName: teamMap.get(pickId)?.name ?? `#${pickId}`,
          tag: bucketLabelFor(sectionId, group, slot.index),
          pct,
          count,
          total,
        };
      }
    }
  }

  const personal: StageWrappedPersonal = {
    displayName: subject.displayName,
    stagePoints,
    correct,
    resolvedSlots,
    totalPoints,
    rankAfter,
    rankMove: delta,
    bestCall,
    avatar: { src: subject.avatarUrl ?? null, label: subject.displayName },
    claims: [...viewerClaims],
  };

  const slides = buildStageWrappedDeck(sectionId, stageLabel, personal, wrappedAssets);
  return slides.length ? { stageKey, eventId, sectionId, title: stageLabel, slides } : null;
}

/**
 * The Hotline (Major) Wrapped auto-deck (PHA-1274). Mirrors the stage launcher
 * above but for the single-elim finale: it builds the live playoff bracket the
 * exact way the picks page does (committed playoff sections + the resolved
 * StageOutcome winners), then HARD-GATES on `isPlayoffWrapped` — the deck is
 * `null` until the Grand Final has crowned a champion, so it can never open
 * before the final is in. Once wrapped, it derives the finale storylines, folds
 * in the curated historic-moment photos, and builds the deck.
 *
 * v1 is the field deck (everyone sees the champion recap); the personal bracket
 * slides are a fast-follow. Cheap: a single playoff StageOutcome query, and it
 * bails immediately when the GF hasn't resolved.
 */
export async function prepareMajorWrappedAutoDeck(
  eventId: number,
  _playerId: string | null,
): Promise<StageWrappedAutoDeck | null> {
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
  const assets = buildWrappedAssets(teamMap);
  const facts = derivePlayoffStorylines(bracket, {
    nameOf: (pid: number) => teamMap.get(pid)?.name ?? null,
  });
  // Lead with the curated historic-moment photo beats (cathedral, donk, woxic,
  // the Cinderellas, magixx) rather than the seed-derived stub; the champion /
  // road / runner-up stay computed from the bracket.
  facts.moments = COLOGNE_PLAYOFF_MOMENTS;

  const slides = buildPlayoffWrappedDeck(facts, null, assets);
  if (slides.length === 0) return null;

  const gfSectionId = PLAYOFF_ROUNDS.find((r) => r.key === "GF")?.sectionId ?? 110;
  return {
    stageKey: `${eventId}:major-wrapped`,
    eventId,
    sectionId: gfSectionId,
    title: "Cologne Major",
    slides,
  };
}

/** The Grand Final section id for this format (the recap deep link target). */
export function majorWrappedSectionId(): number {
  return PLAYOFF_ROUNDS.find((r) => r.key === "GF")?.sectionId ?? 110;
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
 * (`buildPlayoffBracket` + `derivePlayoffStorylines`) so the home send-off names
 * the exact team the recap crowns. Cheap: one query scoped to the playoff
 * sections. Drives the dashboard's "Major complete" hero (PHA-1274).
 */
export async function majorChampion(eventId: number): Promise<MajorChampion | null> {
  const layout = getCommittedLayout();
  const playoffSectionIds = PLAYOFF_ROUNDS.map((r) => r.sectionId);
  const playoffSections = layout.sections.filter((s) => playoffSectionIds.includes(s.sectionid));
  if (playoffSections.length === 0) return null;

  const outcomes = await prisma.stageOutcome.findMany({
    where: { eventId, sectionId: { in: playoffSectionIds } },
  });
  if (outcomes.length === 0) return null;

  const winnerByGroup = new Map<number, number>();
  for (const o of outcomes) if (o.slotIndex === 0) winnerByGroup.set(o.groupId, o.winnerPickId);

  const bracket = buildPlayoffBracket({ sections: playoffSections, winnerByGroup });
  if (!isPlayoffWrapped(bracket)) return null; // no champion crowned yet

  const teamMap = buildTeamMap(layout);
  const facts = derivePlayoffStorylines(bracket, {
    nameOf: (pid: number) => teamMap.get(pid)?.name ?? null,
  });
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
